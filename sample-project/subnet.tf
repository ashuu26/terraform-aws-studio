# Subnet
# Public and private subnets spread across Availability Zones, created with for_each.
# Registry docs:
#   aws_subnet: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/subnet
#   data.aws_availability_zones: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/availability_zones

resource "aws_subnet" "public" {
  for_each = var.public_subnets

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value.cidr_block
  availability_zone       = data.aws_availability_zones.available.names[each.value.az_index]
  map_public_ip_on_launch = var.public_subnet_map_public_ip

  tags = {
    Name = "${local.name_prefix}-${each.key}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  for_each = var.private_subnets

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value.cidr_block
  availability_zone       = data.aws_availability_zones.available.names[each.value.az_index]
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-${each.key}"
    Tier = "private"
  }
}
