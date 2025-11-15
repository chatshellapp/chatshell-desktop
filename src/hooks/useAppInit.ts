import { useEffect, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useModelStore } from '@/stores/modelStore';
import { useTopicStore } from '@/stores/topicStore';
import { useSettingsStore } from '@/stores/settingsStore';

export function useAppInit() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useModelStore((state: any) => state.loadModels);
  const loadAgents = useAgentStore((state: any) => state.loadAgents);
  const agents = useAgentStore((state: any) => state.agents);
  const setCurrentAgent = useAgentStore((state: any) => state.setCurrentAgent);

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

        // Load models first (agents reference models)
        console.log('Loading models...');
        await loadModels();

        // Load agents
        console.log('Loading agents...');
        await loadAgents();
        
        console.log('App initialization complete');
      } catch (err) {
        console.error('Failed to initialize app:', err);
        setError(String(err));
      } finally {
        setIsInitialized(true);
      }
    }

    initialize();
  }, [loadSettings, loadModels, loadAgents]);

  // Once agents are loaded, set the first starred agent as current
  useEffect(() => {
    if (agents.length > 0 && !useAgentStore.getState().currentAgent) {
      console.log(`Found ${agents.length} agents, setting up default agent...`);
      const starredAgent = agents.find((a: any) => a.is_starred);
      const defaultAgent = starredAgent || agents[0];
      console.log('Setting current agent:', defaultAgent.name);
      setCurrentAgent(defaultAgent);

      // Load topics for this agent
      if (defaultAgent) {
        console.log('Loading topics for agent:', defaultAgent.id);
        loadTopics(defaultAgent.id).then(() => {
          const loadedTopics = useTopicStore.getState().topics;
          console.log(`Found ${loadedTopics.length} topics`);
          
          // If no topics exist, create a default one
          if (loadedTopics.length === 0) {
            console.log('No topics found, creating default conversation...');
            createTopic({
              agent_id: defaultAgent.id,
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
  }, [agents, setCurrentAgent, loadTopics, createTopic, setCurrentTopic]);

  return { isInitialized, error };
}

