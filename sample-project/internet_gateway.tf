# Internet Gateway
# Connects the VPC to the internet for resources in public subnets.
# Registry docs:
#   aws_internet_gateway: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/internet_gateway

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}
