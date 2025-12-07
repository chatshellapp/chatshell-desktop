// Helper function to format model name with provider
export const formatModelDisplayName = (
  modelName: string,
  providerId: string,
  getProviderById: (id: string) => { name: string } | undefined
) => {
  const provider = getProviderById(providerId)
  return provider ? `${modelName} - ${provider.name}` : modelName
}

// Global chat message configuration
export const CHAT_CONFIG = {
  userMessageAlign: 'right' as const,
  userMessageShowBackground: true,
}

// Format timestamp from ISO string
export const formatTimestamp = (isoString: string) => {
  const date = new Date(isoString)
  return date.toLocaleString()
}

