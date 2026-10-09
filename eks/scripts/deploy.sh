#!/usr/bin/env bash
# Build -> push to ECR -> Secret from .env -> helm upgrade on EKS.
# Run from the project root:  bash eks/scripts/deploy.sh
#
# Env:
#   TAG       image tag (default: git short SHA, else timestamp). ECR tags are immutable.
#   ENV_FILE  .env with JWT_SECRET, GEMINI_API_KEY, GMAIL_USER, GMAIL_PASS (default .env)
#   CERT_ARN  optional ACM certificate ARN -> HTTPS on the ALB
#   HOST      optional domain for the Ingress (e.g. smartticket.example.com)
# Needs: aws CLI, docker, kubectl, helm, terraform; run bootstrap.sh first.
set -euo pipefail

TF_DIR="eks/terraform"
tf() { terraform -chdir="$TF_DIR" output -raw "$1"; }

REGION="$(tf region)"
REGISTRY="$(tf ecr_registry)"
BACKEND_REPO="$(tf ecr_backend_repository)"
FRONTEND_REPO="$(tf ecr_frontend_repository)"
NAMESPACE="${NAMESPACE:-smartticket}"
ENV_FILE="${ENV_FILE:-.env}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"

echo "==> Login to ECR ($REGISTRY)"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Build and push images ($TAG)"
# EKS nodes are x86_64 (t3). For Graviton (arm64) nodes use --platform linux/arm64.
docker build --platform linux/amd64 -t "$BACKEND_REPO:$TAG" BACKEND
docker build --platform linux/amd64 --build-arg VITE_API_URL=/api -t "$FRONTEND_REPO:$TAG" FRONTEND
docker push "$BACKEND_REPO:$TAG"
docker push "$FRONTEND_REPO:$TAG"

echo "==> Secret backend-secrets"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
if [ -f "$ENV_FILE" ]; then
  kubectl -n "$NAMESPACE" create secret generic backend-secrets \
    --from-env-file="$ENV_FILE" --dry-run=client -o yaml | kubectl apply -f -
elif ! kubectl -n "$NAMESPACE" get secret backend-secrets >/dev/null 2>&1; then
  echo "ERROR: $ENV_FILE not found and no backend-secrets Secret exists" >&2
  exit 1
fi

HELM_ARGS=(
  -f helm/smartticket/values-eks.yaml
  --set images.backend.repository="$BACKEND_REPO"
  --set images.backend.tag="$TAG"
  --set images.frontend.repository="$FRONTEND_REPO"
  --set images.frontend.tag="$TAG"
)
if [ -n "${HOST:-}" ]; then
  HELM_ARGS+=(--set ingress.host="$HOST" --set config.appUrl="https://$HOST")
fi
if [ -n "${CERT_ARN:-}" ]; then
  HELM_ARGS+=(
    --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/certificate-arn"="$CERT_ARN"
    --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/listen-ports"='[{"HTTP": 80}, {"HTTPS": 443}]'
    --set-string ingress.annotations."alb\.ingress\.kubernetes\.io/ssl-redirect"=443
  )
fi

echo "==> helm upgrade --install"
# --atomic: roll back automatically if the release does not become healthy
helm upgrade --install smartticket helm/smartticket \
  --namespace "$NAMESPACE" "${HELM_ARGS[@]}" \
  --atomic --wait --timeout 15m

echo "==> Waiting for the ALB address"
for _ in $(seq 1 60); do
  ALB="$(kubectl -n "$NAMESPACE" get ingress smartticket -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
  [ -n "$ALB" ] && break
  sleep 5
done

echo
echo "Deployed $TAG"
echo "App URL: http://${ALB:-<pending, check: kubectl -n $NAMESPACE get ingress>}"
echo "(a new ALB can take 2-3 minutes before DNS resolves)"
