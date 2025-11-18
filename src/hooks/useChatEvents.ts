import { useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMessageStore } from '@/stores/messageStore';
import { useConversationStore } from '@/stores/conversationStore';
import type {
  ChatStreamEvent,
  ChatCompleteEvent,
  ScrapingStartedEvent,
  ScrapingCompleteEvent,
  ScrapingErrorEvent,
} from '@/types';

interface ConversationUpdatedEvent {
  conversation_id: string;
  title: string;
}

interface GenerationStoppedEvent {
  conversation_id: string;
}

export function useChatEvents(conversationId: string | null) {
  const conversationIdRef = useRef(conversationId);
  
  // Update ref when conversationId changes
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Create stable callback references using useCallback
  // These now take conversationId as parameter
  const handleStreamChunk = useCallback((convId: string, chunk: string) => {
    console.log('[useChatEvents] Appending chunk to conversation:', convId);
    useMessageStore.getState().appendStreamingChunk(convId, chunk);
  }, []);

  const handleChatComplete = useCallback((convId: string, message: any) => {
    console.log('[useChatEvents] handleChatComplete called for conversation:', convId, 'message:', message);
    const store = useMessageStore.getState();
    const convState = store.getConversationState(convId);
    console.log('[useChatEvents] Current messages count for conversation:', convState.messages.length);
    store.addMessage(convId, message);
    console.log('[useChatEvents] After addMessage, messages count:', store.getConversationState(convId).messages.length);
    store.setIsStreaming(convId, false);
    store.setStreamingContent(convId, '');
  }, []);

  const handleScrapingStarted = useCallback((convId: string) => {
    useMessageStore.getState().setScrapingStatus(convId, 'scraping');
  }, []);

  const handleScrapingComplete = useCallback((convId: string) => {
    useMessageStore.getState().setScrapingStatus(convId, 'complete');
  }, []);

  const handleScrapingError = useCallback((convId: string, error: string) => {
    useMessageStore.getState().setScrapingStatus(convId, 'error');
    console.error('Scraping error:', error);
  }, []);

  const handleConversationUpdated = useCallback((conversationId: string, title: string) => {
    console.log('[useChatEvents] Conversation title updated:', conversationId, title);
    const conversationStore = useConversationStore.getState();
    
    // Update the conversation in the list
    const updatedConversations = conversationStore.conversations.map(conv => 
      conv.id === conversationId ? { ...conv, title } : conv
    );
    
    // Update the store
    useConversationStore.setState({ conversations: updatedConversations });
    
    // If it's the current conversation, update that too
    if (conversationStore.currentConversation?.id === conversationId) {
      useConversationStore.setState({
        currentConversation: { ...conversationStore.currentConversation, title }
      });
    }
  }, []);

  const handleGenerationStopped = useCallback((convId: string) => {
    console.log('[useChatEvents] Generation stopped for conversation:', convId);
    // Don't clear anything here - let the chat-complete event handle the final state
    // This prevents the message from disappearing before it's saved
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    console.log('[useChatEvents] Setting up event listeners for conversation:', conversationId);

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      console.log('[useChatEvents] Received chat-stream event:', event.payload);
      console.log('[useChatEvents] Event conversation_id:', event.payload.conversation_id, 'Current:', conversationIdRef.current);
      // Process the event for the specific conversation (no need to check if it's current)
      handleStreamChunk(event.payload.conversation_id, event.payload.content);
    });

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      console.log('[useChatEvents] Received chat-complete event:', event.payload);
      console.log('[useChatEvents] Event conversation_id:', event.payload.conversation_id, 'Current:', conversationIdRef.current);
      // Process the event for the specific conversation (no need to check if it's current)
      handleChatComplete(event.payload.conversation_id, event.payload.message);
    });

    // Listen for scraping started
    const unlistenScrapingStarted = listen<ScrapingStartedEvent>(
      'scraping-started',
      (event) => {
        handleScrapingStarted(event.payload.conversation_id);
      }
    );

    // Listen for scraping complete
    const unlistenScrapingComplete = listen<ScrapingCompleteEvent>(
      'scraping-complete',
      (event) => {
        handleScrapingComplete(event.payload.conversation_id);
      }
    );

    // Listen for scraping errors
    const unlistenScrapingError = listen<ScrapingErrorEvent>(
      'scraping-error',
      (event) => {
        handleScrapingError(event.payload.conversation_id, event.payload.error);
      }
    );

    // Listen for conversation updates (title changes)
    const unlistenConversationUpdated = listen<ConversationUpdatedEvent>(
      'conversation-updated',
      (event) => {
        console.log('[useChatEvents] Received conversation-updated event:', event.payload);
        handleConversationUpdated(event.payload.conversation_id, event.payload.title);
      }
    );

    // Listen for generation stopped
    const unlistenGenerationStopped = listen<GenerationStoppedEvent>(
      'generation-stopped',
      (event) => {
        console.log('[useChatEvents] Received generation-stopped event:', event.payload);
        handleGenerationStopped(event.payload.conversation_id);
      }
    );

    // Cleanup listeners when component unmounts or conversationId changes
    return () => {
      console.log('[useChatEvents] Cleaning up event listeners for conversation:', conversationId);
      unlistenStream.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenScrapingStarted.then((fn) => fn());
      unlistenScrapingComplete.then((fn) => fn());
      unlistenScrapingError.then((fn) => fn());
      unlistenConversationUpdated.then((fn) => fn());
      unlistenGenerationStopped.then((fn) => fn());
    };
  }, [
    conversationId,
    handleStreamChunk,
    handleChatComplete,
    handleScrapingStarted,
    handleScrapingComplete,
    handleScrapingError,
    handleConversationUpdated,
    handleGenerationStopped,
  ]);
}
