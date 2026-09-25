# Security Group
# A stateful firewall, with each rule managed as its own resource (the current recommended pattern).
# Registry docs:
#   aws_security_group: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/security_group
#   aws_vpc_security_group_ingress_rule: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_ingress_rule
#   aws_vpc_security_group_egress_rule: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/vpc_security_group_egress_rule

resource "aws_security_group" "main" {
  name_prefix = "${local.name_prefix}-app-"
  description = "Application security group managed by Terraform"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-app-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "app" {
  for_each = var.sg_ingress_rules

  security_group_id = aws_security_group.main.id
  description       = each.value.description
  cidr_ipv4         = each.value.cidr_ipv4
  from_port         = each.value.port
  to_port           = each.value.port
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.main.id
  description       = "Allow all outbound traffic"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
