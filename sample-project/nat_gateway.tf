# NAT Gateway
# Lets resources in private subnets reach the internet without being reachable from it.
# Registry docs:
#   aws_nat_gateway: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/nat_gateway
#   aws_eip: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/eip

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-eip"
  }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = values(aws_subnet.public)[0].id

  tags = {
    Name = "${local.name_prefix}-nat"
  }

  # The AWS provider docs recommend this explicit dependency so the
  # internet gateway exists before the NAT gateway starts routing.
  depends_on = [aws_internet_gateway.main]
}
