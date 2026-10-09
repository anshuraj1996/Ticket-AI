#!/usr/bin/env bash
# One-time cluster setup after `terraform apply`:
#   kubeconfig, gp3 StorageClass, AWS Load Balancer Controller, metrics-server, app namespace.
# Run from the project root:  bash eks/scripts/bootstrap.sh
# Needs: aws CLI, kubectl, helm, terraform (for the outputs).
set -euo pipefail

TF_DIR="eks/terraform"
tf() { terraform -chdir="$TF_DIR" output -raw "$1"; }

REGION="$(tf region)"
CLUSTER="$(tf cluster_name)"
VPC_ID="$(tf vpc_id)"
LB_ROLE_ARN="$(tf lb_controller_role_arn)"
NAMESPACE="${NAMESPACE:-smartticket}"

echo "==> kubeconfig for $CLUSTER ($REGION)"
aws eks update-kubeconfig --region "$REGION" --name "$CLUSTER"

echo "==> gp3 as the default StorageClass"
kubectl apply -f eks/k8s/storageclass-gp3.yaml
if kubectl get storageclass gp2 >/dev/null 2>&1; then
  kubectl annotate storageclass gp2 storageclass.kubernetes.io/is-default-class=false --overwrite
fi

echo "==> Helm repositories"
helm repo add eks https://aws.github.io/eks-charts >/dev/null
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ >/dev/null
helm repo update >/dev/null

echo "==> AWS Load Balancer Controller (Ingress -> ALB)"
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --set clusterName="$CLUSTER" \
  --set region="$REGION" \
  --set vpcId="$VPC_ID" \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="$LB_ROLE_ARN" \
  --wait

echo "==> metrics-server (needed by the HPAs)"
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system --wait

echo "==> Namespace $NAMESPACE"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo
echo "Cluster ready. Next: bash eks/scripts/deploy.sh"
