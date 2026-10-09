#!/usr/bin/env bash
# Build images, load them into minikube, create the Secret and apply all manifests.
# Run from the project root:  ./k8s/deploy-minikube.sh
#
# Env:
#   TAG       image tag (default 1.0.0, must match the manifests)
#   ENV_FILE  file with JWT_SECRET, GEMINI_API_KEY, GMAIL_USER, GMAIL_PASS (default .env)
set -euo pipefail
export MSYS_NO_PATHCONV=1

TAG="${TAG:-1.0.0}"
ENV_FILE="${ENV_FILE:-.env}"
NODE="${MINIKUBE_CONTAINER:-minikube}"
K="./k8s/mk-kubectl.sh"

echo "==> Building images ($TAG)"
docker build -t "smartticket-backend:$TAG" BACKEND
docker build -t "smartticket-frontend:$TAG" --build-arg VITE_API_URL=/api FRONTEND

echo "==> Loading images into minikube (no registry needed)"
for img in "smartticket-backend:$TAG" "smartticket-frontend:$TAG"; do
  docker save "$img" | docker exec -i "$NODE" docker load
done

echo "==> Namespace"
$K apply -f - < k8s/namespace.yaml

echo "==> Secret backend-secrets"
if [ -f "$ENV_FILE" ]; then
  # Copy the env file into the node, build + apply the Secret there, then remove the copy
  docker exec -i "$NODE" sh -c 'cat > /tmp/smartticket.env' < "$ENV_FILE"
  $K -n smartticket create secret generic backend-secrets \
    --from-env-file=/tmp/smartticket.env --dry-run=client -o yaml | $K apply -f -
  docker exec "$NODE" rm -f /tmp/smartticket.env
else
  echo "    $ENV_FILE not found, skipping. Create it from .env.example, or:"
  echo "    $K -n smartticket create secret generic backend-secrets --from-literal=JWT_SECRET=..."
fi

echo "==> Applying manifests"
# Copy k8s/ into the node and let its kubectl run kustomize (no kubectl needed on the host)
docker exec "$NODE" rm -rf /tmp/smartticket-k8s
docker exec "$NODE" mkdir -p /tmp/smartticket-k8s
tar -C k8s -cf - . | docker exec -i "$NODE" tar -xf - -C /tmp/smartticket-k8s
$K apply -k /tmp/smartticket-k8s

echo "==> Restarting app deployments to pick up new images"
$K -n smartticket rollout restart deployment/backend deployment/ticket-consumer deployment/frontend

echo
echo "Done. Watch:  $K -n smartticket get pods -w"
echo "Open app:     minikube service frontend -n smartticket --url"
