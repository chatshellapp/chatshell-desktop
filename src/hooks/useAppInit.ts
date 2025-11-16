import { useEffect, useState } from 'react';
import { useAssistantStore } from '@/stores/assistantStore';
import { useModelStore } from '@/stores/modelStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function useAppInit() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useModelStore((state: any) => state.loadAll);
  const loadAssistants = useAssistantStore((state: any) => state.loadAssistants);
  const loadConversations = useConversationStore((state: any) => state.loadConversations);
  const conversations = useConversationStore((state: any) => state.conversations);
  const setCurrentConversation = useConversationStore((state: any) => state.setCurrentConversation);
  const loadSettings = useSettingsStore((state: any) => state.loadSettings);

  useEffect(() => {
    async function initialize() {
      try {
        console.log('Initializing app...');
        
        // Load settings
        console.log('Loading settings...');
        await loadSettings();

        // Load models and providers first (assistants reference models)
        console.log('Loading models and providers...');
        await loadAll();

        // Load assistants (optional - users can use models directly)
        console.log('Loading assistants...');
        await loadAssistants();
        
        // Load conversations
        console.log('Loading conversations...');
        await loadConversations();
        
        console.log('App initialization complete');
      } catch (err) {
        console.error('Failed to initialize app:', err);
        setError(String(err));
      } finally {
        setIsInitialized(true);
      }
    }

    initialize();
  }, [loadSettings, loadAll, loadAssistants, loadConversations]);

  // Once conversations are loaded, set the first one as current (if any exist)
  useEffect(() => {
    if (conversations.length > 0 && !useConversationStore.getState().currentConversation) {
      console.log(`Found ${conversations.length} conversations, setting first as current...`);
      setCurrentConversation(conversations[0]);
    }
  }, [conversations, setCurrentConversation]);

  return { isInitialized, error };
}
