# providers.tf
# Terraform and provider requirements.
# Authentication is NOT configured here: the AWS provider uses the standard
# credential chain (AWS_PROFILE / IAM Identity Center, environment, or an IAM role).

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state with native S3 locking (Terraform 1.10+). Uncomment after creating the bucket.
  # backend "s3" {
  #   bucket       = "my-terraform-state-bucket"
  #   key          = "tf-learning/terraform.tfstate"
  #   region       = "ap-southeast-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}
