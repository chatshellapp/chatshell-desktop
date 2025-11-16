import { useEffect, useState } from 'react';
import { useAssistantStore } from '@/stores/assistantStore';
import { useModelStore } from '@/stores/modelStore';
import { useTopicStore } from '@/stores/topicStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function useAppInit() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useModelStore((state: any) => state.loadAll);
  const loadAssistants = useAssistantStore((state: any) => state.loadAssistants);
  const assistants = useAssistantStore((state: any) => state.assistants);
  const setCurrentAssistant = useAssistantStore((state: any) => state.setCurrentAssistant);

  const loadTopics = useTopicStore((state: any) => state.loadTopics);
  const topics = useTopicStore((state: any) => state.topics);
  const createTopic = useTopicStore((state: any) => state.createTopic);
  const setCurrentTopic = useTopicStore((state: any) => state.setCurrentTopic);

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

        // Load assistants
        console.log('Loading assistants...');
        await loadAssistants();
        
        console.log('App initialization complete');
      } catch (err) {
        console.error('Failed to initialize app:', err);
        setError(String(err));
      } finally {
        setIsInitialized(true);
      }
    }

    initialize();
  }, [loadSettings, loadAll, loadAssistants]);

  // Once assistants are loaded, set the first starred assistant as current
  useEffect(() => {
    if (assistants.length > 0 && !useAssistantStore.getState().currentAssistant) {
      console.log(`Found ${assistants.length} assistants, setting up default assistant...`);
      const starredAssistant = assistants.find((a: any) => a.is_starred);
      const defaultAssistant = starredAssistant || assistants[0];
      console.log('Setting current assistant:', defaultAssistant.name);
      setCurrentAssistant(defaultAssistant);

      // Load topics for this assistant
      if (defaultAssistant) {
        console.log('Loading topics for assistant:', defaultAssistant.id);
        loadTopics(defaultAssistant.id).then(() => {
          const loadedTopics = useTopicStore.getState().topics;
          console.log(`Found ${loadedTopics.length} topics`);
          
          // If no topics exist, create a default one
          if (loadedTopics.length === 0) {
            console.log('No topics found, creating default conversation...');
            createTopic({
              assistant_id: defaultAssistant.id,
              title: 'New Conversation',
            }).then((topic: any) => {
              console.log('Created topic:', topic);
              setCurrentTopic(topic);
            }).catch((err: any) => {
              console.error('Failed to create topic:', err);
            });
          } else {
            // Set the first topic as current
            console.log('Setting current topic:', loadedTopics[0].title);
            setCurrentTopic(loadedTopics[0]);
          }
        }).catch((err: any) => {
          console.error('Failed to load topics:', err);
        });
      }
    }
  }, [assistants, setCurrentAssistant, loadTopics, createTopic, setCurrentTopic]);

  return { isInitialized, error };
}

