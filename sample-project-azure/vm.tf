# Virtual Machines
# Linux or Windows VMs with Trusted Launch, a NIC each in the app subnet, managed boot diagnostics and a managed identity.
# Registry docs:
#   azurerm_network_interface: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/network_interface
#   azurerm_linux_virtual_machine: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/linux_virtual_machine
# Azure docs: https://learn.microsoft.com/azure/virtual-machines/overview

resource "azurerm_network_interface" "vm" {
  for_each = var.vms

  name                = "nic-${local.name_prefix}-${each.key}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.this["app"].id
    private_ip_address_allocation = "Dynamic"
  }

  tags = local.common_tags
}

resource "azurerm_linux_virtual_machine" "main" {
  for_each = var.vms

  name                  = "vm-${local.name_prefix}-${each.key}"
  resource_group_name   = azurerm_resource_group.main.name
  location              = azurerm_resource_group.main.location
  size                  = var.vm_size
  zone                  = each.value.zone
  network_interface_ids = [azurerm_network_interface.vm[each.key].id]

  admin_username                  = var.admin_username
  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.admin_ssh_public_key
  }

  # Trusted Launch: Secure Boot and a virtual TPM.
  secure_boot_enabled   = true
  vtpm_enabled          = true
  patch_mode            = "AutomaticByPlatform"
  patch_assessment_mode = "AutomaticByPlatform"

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = var.vm_os_disk_type
    disk_size_gb         = var.vm_os_disk_size_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  # Managed boot diagnostics: no storage account needed.
  boot_diagnostics {
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.common_tags
}
