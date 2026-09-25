# VPC
# An isolated virtual network that every other networking resource lives inside.
# Registry docs:
#   aws_vpc: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = var.vpc_enable_dns_support
  enable_dns_hostnames = var.vpc_enable_dns_hostnames

  tags = {
    Name = var.vpc_name
  }
}
