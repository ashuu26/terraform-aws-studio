# variables.tf
# Every tunable value lives here. Override them in terraform.tfvars.

# Global

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-southeast-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-\\d$", var.aws_region))
    error_message = "aws_region must look like ap-southeast-1."
  }
}

variable "project_name" {
  description = "Short project name used in resource names (lowercase, hyphens)"
  type        = string
  default     = "tf-learning"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project_name))
    error_message = "project_name must be 2-21 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "additional_tags" {
  description = "Extra tags merged into the provider default_tags"
  type        = map(string)
  default     = {}
}

# VPC

variable "vpc_name" {
  description = "Name tag for the VPC"
  type        = string
  default     = "learning-vpc"
}

variable "vpc_cidr" {
  description = "IPv4 CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "vpc_cidr must be a valid IPv4 CIDR block, for example 10.0.0.0/16."
  }
}

variable "vpc_enable_dns_support" {
  description = "Enable the Amazon-provided DNS resolver in the VPC"
  type        = bool
  default     = true
}

variable "vpc_enable_dns_hostnames" {
  description = "Assign public DNS hostnames to instances with public IPs"
  type        = bool
  default     = true
}

# Subnet

variable "public_subnets" {
  description = "Public subnets keyed by name; az_index picks an Availability Zone"
  type        = map(object({ cidr_block = string, az_index = number }))
  default     = {
    public-a = {
      cidr_block = "10.0.1.0/24"
      az_index   = 0
    }
    public-b = {
      cidr_block = "10.0.2.0/24"
      az_index   = 1
    }
  }
}

variable "private_subnets" {
  description = "Private subnets keyed by name; az_index picks an Availability Zone"
  type        = map(object({ cidr_block = string, az_index = number }))
  default     = {
    private-a = {
      cidr_block = "10.0.11.0/24"
      az_index   = 0
    }
    private-b = {
      cidr_block = "10.0.12.0/24"
      az_index   = 1
    }
  }
}

variable "public_subnet_map_public_ip" {
  description = "Auto-assign public IPv4 addresses to instances launched in public subnets"
  type        = bool
  default     = false
}

# Security Group

variable "sg_ingress_rules" {
  description = "Inbound rules for the application security group"
  type        = map(object({ port = number, cidr_ipv4 = string, description = string }))
  default     = {
    tcp-443 = {
      port        = 443
      cidr_ipv4   = "10.0.0.0/16"
      description = "Allow TCP 443"
    }
    tcp-80 = {
      port        = 80
      cidr_ipv4   = "10.0.0.0/16"
      description = "Allow TCP 80"
    }
  }
}

# EC2 Instance

variable "ec2_instance_name" {
  description = "Name tag for the EC2 instance"
  type        = string
  default     = "web-server"
}

variable "ec2_ami_id" {
  description = "Explicit AMI ID. Leave null to use the latest Amazon Linux 2023 AMI"
  type        = string
  default     = null
}

variable "ec2_instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "ec2_root_volume_size" {
  description = "Root volume size in GiB"
  type        = number
  default     = 20

  validation {
    condition     = var.ec2_root_volume_size >= 8
    error_message = "Amazon Linux 2023 needs a root volume of at least 8 GiB."
  }
}

variable "ec2_detailed_monitoring" {
  description = "Enable 1-minute CloudWatch detailed monitoring"
  type        = bool
  default     = true
}
