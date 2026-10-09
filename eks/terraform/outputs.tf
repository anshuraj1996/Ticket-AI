output "region" {
  value = var.region
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "ecr_registry" {
  description = "Registry host for docker login"
  value       = split("/", aws_ecr_repository.app["smartticket-backend"].repository_url)[0]
}

output "ecr_backend_repository" {
  value = aws_ecr_repository.app["smartticket-backend"].repository_url
}

output "ecr_frontend_repository" {
  value = aws_ecr_repository.app["smartticket-frontend"].repository_url
}

output "lb_controller_role_arn" {
  description = "IRSA role for the AWS Load Balancer Controller (used by bootstrap.sh)"
  value       = module.lb_controller_irsa.iam_role_arn
}

output "configure_kubectl" {
  value = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}
