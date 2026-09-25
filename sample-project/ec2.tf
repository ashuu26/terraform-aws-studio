# EC2 Instance
# A virtual machine running the latest Amazon Linux 2023, with IMDSv2 and an encrypted gp3 root volume.
# Registry docs:
#   aws_instance: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance
#   data.aws_ami: https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami

resource "aws_instance" "main" {
  ami                    = coalesce(var.ec2_ami_id, data.aws_ami.al2023_x86_64.id)
  instance_type          = var.ec2_instance_type
  subnet_id              = values(aws_subnet.private)[0].id
  vpc_security_group_ids = [aws_security_group.main.id]
  monitoring             = var.ec2_detailed_monitoring

  # IMDSv2 only: blocks the SSRF credential-theft pattern that IMDSv1 allows.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_size = var.ec2_root_volume_size
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = var.ec2_instance_name
  }
}
