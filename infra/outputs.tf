output "instance_id" {
  description = "EC2 instance id."
  value       = aws_instance.runner.id
}

output "public_ip" {
  description = "Public IPv4 address of the runner."
  value       = aws_instance.runner.public_ip
}

output "ssh_command" {
  description = "SSH into the runner, forwarding Grafana (3000) and ClickHouse HTTP (8123) to localhost."
  value       = "ssh -L 3000:127.0.0.1:3000 -L 8123:127.0.0.1:8123 ubuntu@${aws_instance.runner.public_ip}"
}

output "market" {
  description = "Whether the instance runs on spot or on-demand capacity."
  value       = var.use_spot ? "spot" : "on-demand"
}

output "ami_id" {
  description = "Ubuntu AMI the instance booted from."
  value       = data.aws_ami.ubuntu.id
}
