using './main.bicep'

// Fill these in for your Azure Government subscription.
param accountName = 'amentum-ai-openai'
param location = 'usgovvirginia'
param disableLocalAuth = true
param publicNetworkAccess = 'Disabled'

// Replace <model-version> with the versions listed by:
//   az cognitiveservices account list-models -n amentum-ai-openai -g <rg> -o table
// Use whichever GPT-5.6 models (Sol / Terra / Luna) are offered in your region; the app's
// config/models.json maps friendly names to these deployment names.
param deployments = [
  { name: 'gpt-5.6-sol', model: 'gpt-5.6-sol', version: '<model-version>', sku: 'DataZoneStandard', capacity: 50 }
  { name: 'gpt-5.6-terra', model: 'gpt-5.6-terra', version: '<model-version>', sku: 'DataZoneStandard', capacity: 150 }
  { name: 'gpt-5.6-luna', model: 'gpt-5.6-luna', version: '<model-version>', sku: 'DataZoneStandard', capacity: 300 }
]

// Object id of the app registration's service principal (or the VM/container managed identity)
param appPrincipalId = ''

// Private networking (recommended): subnet for the private endpoint + VNet for DNS
param privateEndpointSubnetId = ''
param privateDnsVnetId = ''
