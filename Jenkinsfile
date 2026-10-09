// SmartTicket AI: test -> build -> load into minikube -> deploy -> smoke test
//
// Requirements on the Jenkins agent: git, bash and the docker CLI (with access to the
// same Docker daemon that runs the "minikube" container). Node and kubectl are NOT
// needed: tests run inside the backend "test" image, and kubectl runs inside minikube.
//
// Optional Jenkins credential:
//   smartticket-env  (Secret file) = the .env with JWT_SECRET, GEMINI_API_KEY, GMAIL_USER, GMAIL_PASS
//   If it is missing, the existing backend-secrets Secret in the cluster is kept.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timeout(time: 30, unit: 'MINUTES')
  }

  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Deploy to minikube after the tests pass')
  }

  environment {
    IMAGE_TAG          = "${env.BUILD_NUMBER}"
    BACKEND_IMAGE      = 'smartticket-backend'
    FRONTEND_IMAGE     = 'smartticket-frontend'
    TEST_IMAGE         = "smartticket-backend-test:${env.BUILD_NUMBER}"
    NAMESPACE          = 'smartticket'
    MINIKUBE_CONTAINER = 'minikube'
    K                  = 'bash k8s/mk-kubectl.sh' // kubectl inside the minikube container
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git log -1 --oneline'
      }
    }

    stage('Backend unit tests') {
      steps {
        sh 'docker build --target test -t "$TEST_IMAGE" BACKEND'
        sh '''
          set +e
          name="smartticket-test-$BUILD_NUMBER"
          docker rm -f "$name" >/dev/null 2>&1
          docker run --name "$name" "$TEST_IMAGE"
          status=$?
          rm -rf reports && mkdir -p reports
          docker cp "$name:/app/reports/." reports/
          docker rm -f "$name" >/dev/null 2>&1
          exit $status
        '''
      }
      post {
        always {
          junit allowEmptyResults: true, testResults: 'reports/*.xml'
        }
      }
    }

    stage('Build images') {
      parallel {
        stage('Backend image') {
          steps {
            sh 'docker build -t "$BACKEND_IMAGE:$IMAGE_TAG" -t "$BACKEND_IMAGE:latest" BACKEND'
          }
        }
        stage('Frontend image') {
          steps {
            // The Vite build runs inside this docker build, so a broken frontend fails here
            sh 'docker build --build-arg VITE_API_URL=/api -t "$FRONTEND_IMAGE:$IMAGE_TAG" -t "$FRONTEND_IMAGE:latest" FRONTEND'
          }
        }
      }
    }

    stage('Load images into minikube') {
      when { expression { params.DEPLOY } }
      steps {
        // minikube has its own Docker runtime: copy the images in (no registry needed)
        sh '''
          for img in "$BACKEND_IMAGE:$IMAGE_TAG" "$FRONTEND_IMAGE:$IMAGE_TAG"; do
            docker save "$img" | docker exec -i "$MINIKUBE_CONTAINER" docker load
          done
        '''
      }
    }

    stage('Secrets') {
      when { expression { params.DEPLOY } }
      steps {
        script {
          try {
            withCredentials([file(credentialsId: 'smartticket-env', variable: 'ENV_FILE')]) {
              sh '''
                docker exec -i "$MINIKUBE_CONTAINER" sh -c 'cat > /tmp/smartticket.env' < "$ENV_FILE"
                $K apply -f - < k8s/namespace.yaml
                $K -n "$NAMESPACE" create secret generic backend-secrets \
                  --from-env-file=/tmp/smartticket.env --dry-run=client -o yaml | $K apply -f -
                docker exec "$MINIKUBE_CONTAINER" rm -f /tmp/smartticket.env
              '''
            }
          } catch (err) {
            echo "Credential 'smartticket-env' not available (${err.message}); keeping the existing backend-secrets Secret."
          }
        }
      }
    }

    stage('Deploy to minikube') {
      when { expression { params.DEPLOY } }
      steps {
        sh '''
          # Copy the manifests into the node and let its kubectl run kustomize
          docker exec "$MINIKUBE_CONTAINER" rm -rf /tmp/smartticket-k8s
          docker exec "$MINIKUBE_CONTAINER" mkdir -p /tmp/smartticket-k8s
          tar -C k8s -cf - . | docker exec -i "$MINIKUBE_CONTAINER" tar -xf - -C /tmp/smartticket-k8s
          $K apply -k /tmp/smartticket-k8s

          # Manifests pin 1.0.0; roll the app to this build's images
          $K -n "$NAMESPACE" set image deployment/backend         backend="$BACKEND_IMAGE:$IMAGE_TAG"
          $K -n "$NAMESPACE" set image deployment/ticket-consumer consumer="$BACKEND_IMAGE:$IMAGE_TAG"
          $K -n "$NAMESPACE" set image deployment/frontend        frontend="$FRONTEND_IMAGE:$IMAGE_TAG"

          for d in backend ticket-consumer frontend; do
            $K -n "$NAMESPACE" rollout status "deployment/$d" --timeout=300s
          done
        '''
      }
      post {
        failure {
          sh '''
            $K -n "$NAMESPACE" get pods -o wide || true
            $K -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -30 || true
          '''
        }
      }
    }

    stage('Smoke test') {
      when { expression { params.DEPLOY } }
      steps {
        // Throwaway pod inside the cluster: frontend health, backend readiness (Mongo connected),
        // and the nginx /api proxy (no token -> 401 is the expected answer)
        sh '''
          $K -n "$NAMESPACE" delete pod smoke-test --ignore-not-found
          # The label lets this pod through the allow-backend NetworkPolicy
          $K -n "$NAMESPACE" run smoke-test --rm -i --restart=Never --image=busybox:1.36 \
            --labels=app.kubernetes.io/name=smoke-test -- sh -c '
            set -e
            wget -qO- http://frontend/healthz
            wget -qO- http://backend:3000/readyz
            code=$(wget -S -O /dev/null http://frontend/api/tickets 2>&1 | grep "HTTP/" | tail -1 | awk "{print \\$2}")
            echo "GET /api/tickets via nginx -> $code"
            [ "$code" = "401" ]
          '
        '''
      }
    }
  }

  post {
    always {
      sh 'docker rmi "$TEST_IMAGE" >/dev/null 2>&1 || true'
    }
    success {
      echo "Deployed build ${env.IMAGE_TAG}. Open: minikube service frontend -n ${env.NAMESPACE} --url"
    }
  }
}
