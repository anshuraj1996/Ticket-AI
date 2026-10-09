#!/usr/bin/env bash
# Tear everything down in the right order, so nothing keeps costing money.
#   1) helm uninstall  -> the Load Balancer Controller deletes the ALB + its security groups
#   2) delete PVCs     -> EBS volumes are released
#   3) terraform destroy
# Skipping 1-2 leaves ALB/ENIs/volumes behind and `terraform destroy` hangs on the VPC.
# Run from the project root:  bash eks/scripts/destroy.sh
set -euo pipefail

NAMESPACE="${NAMESPACE:-smartticket}"

read -r -p "Destroy the SmartTicket EKS cluster, its data and ECR images? Type 'destroy': " answer
[ "$answer" = "destroy" ] || { echo "Aborted."; exit 1; }

echo "==> helm uninstall (removes the ALB)"
helm uninstall smartticket -n "$NAMESPACE" --wait || true

echo "==> Waiting for the Ingress/ALB to be gone"
for _ in $(seq 1 60); do
  kubectl -n "$NAMESPACE" get ingress smartticket >/dev/null 2>&1 || break
  sleep 5
done

echo "==> Deleting namespace (PVCs incl. the kept mongo-backups volume)"
kubectl delete namespace "$NAMESPACE" --wait=true --ignore-not-found

echo "==> Removing cluster add-ons"
helm uninstall aws-load-balancer-controller -n kube-system || true
helm uninstall metrics-server -n kube-system || true

echo "==> terraform destroy"
terraform -chdir=eks/terraform destroy
