terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  # Remote state (recommended for teams/CI): copy backend.tf.example to backend.tf
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "smartticket"
      ManagedBy = "terraform"
      Owner     = var.owner
    }
  }
}
