variable "region" {
  description = "AWS region for the cluster"
  type        = string
  default     = "ap-south-1"
}

variable "owner" {
  description = "Owner tag applied to every resource"
  type        = string
  default     = "anshuman-singh"
}

variable "cluster_name" {
  description = "EKS cluster name (also used for the VPC and IAM role names)"
  type        = string
  default     = "smartticket"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version"
  type        = string
  default     = "1.33"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "node_instance_types" {
  description = "Instance types for the managed node group"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT (SPOT is cheaper for dev, can be interrupted)"
  type        = string
  default     = "ON_DEMAND"
}

variable "node_min_size" {
  type    = number
  default = 2
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "node_max_size" {
  type    = number
  default = 4
}

variable "app_namespace" {
  description = "Kubernetes namespace the app is deployed into"
  type        = string
  default     = "smartticket"
}

variable "ci_principal_arn" {
  description = "Optional IAM role/user ARN used by CI (Jenkins). Gets admin rights in app_namespace only."
  type        = string
  default     = ""
}

variable "ecr_force_delete" {
  description = "Allow `terraform destroy` to delete ECR repositories that still contain images"
  type        = bool
  default     = false
}
