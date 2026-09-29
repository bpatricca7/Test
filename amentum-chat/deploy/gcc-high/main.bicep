// Azure OpenAI for Amentum AI in Azure Government (GCC High).
//
//   az cloud set --name AzureUSGovernment
//   az login
//   az deployment group create -g <rg> -f main.bicep -p main.bicepparam
//
// Creates: Azure OpenAI account (custom subdomain -> https://<name>.openai.azure.us/),
// model deployments, optional private endpoint + privatelink.openai.azure.us DNS, and the
// "Cognitive Services OpenAI User" role for the app's identity (Entra ID auth).

@description('Azure Government region, e.g. usgovvirginia or usgovarizona.')
param location string = resourceGroup().location

@description('Account name; also the custom subdomain (<name>.openai.azure.us).')
@minLength(2)
@maxLength(64)
param accountName string

@description('Disable API keys so only Entra ID tokens are accepted (recommended).')
param disableLocalAuth bool = true

@description('Public network access. Use Disabled with a private endpoint for production.')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Disabled'

@description('Egress IPs of the Amentum network allowed when public access is Enabled (CIDR list).')
param allowedIpRanges array = []

@description('''Model deployments. Look up the exact model names/versions available in your region with:
az cognitiveservices account list-models -n <account> -g <rg> -o table''')
param deployments array = [
  {
    name: 'gpt-5.6-terra'
    model: 'gpt-5.6-terra'
    version: '<model-version>'
    sku: 'DataZoneStandard'
    capacity: 100
  }
]

@description('Object id of the app identity (service principal or managed identity) that calls the model. Empty = skip.')
param appPrincipalId string = ''

@description('Subnet resource id for a private endpoint. Empty = no private endpoint.')
param privateEndpointSubnetId string = ''

@description('VNet resource id to link the privatelink.openai.azure.us zone to. Empty = no DNS zone.')
param privateDnsVnetId string = ''

param tags object = {
  application: 'amentum-ai'
}

var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  tags: tags
  properties: {
    customSubDomainName: accountName
    disableLocalAuth: disableLocalAuth
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      defaultAction: 'Deny'
      ipRules: [for ip in allowedIpRanges: {
        value: ip
      }]
    }
  }
}

@batchSize(1)
resource modelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [for d in deployments: {
  parent: account
  name: d.name
  sku: {
    name: d.sku
    capacity: d.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: d.model
      version: d.version
    }
    versionUpgradeOption: 'NoAutoUpgrade'
  }
}]

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(appPrincipalId)) {
  name: guid(account.id, appPrincipalId, openAiUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (!empty(privateEndpointSubnetId)) {
  name: '${accountName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'openai'
        properties: {
          privateLinkServiceId: account.id
          groupIds: ['account']
        }
      }
    ]
  }
}

resource dnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (!empty(privateDnsVnetId)) {
  name: 'privatelink.openai.azure.us'
  location: 'global'
  tags: tags
}

resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (!empty(privateDnsVnetId)) {
  parent: dnsZone
  name: '${accountName}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: privateDnsVnetId
    }
  }
}

resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (!empty(privateEndpointSubnetId) && !empty(privateDnsVnetId)) {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'openai'
        properties: {
          privateDnsZoneId: dnsZone.id
        }
      }
    ]
  }
}

output endpoint string = account.properties.endpoint
output accountId string = account.id
output deploymentNames array = [for (d, i) in deployments: modelDeployments[i].name]
