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

export function useChatEvents(conversationId: string | null) {
  const conversationIdRef = useRef(conversationId);
  
  // Update ref when conversationId changes
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Create stable callback references using useCallback with no dependencies
  // We use refs to access the latest values without re-creating the callbacks
  const handleStreamChunk = useCallback((chunk: string) => {
    useMessageStore.getState().appendStreamingChunk(chunk);
  }, []);

  const handleChatComplete = useCallback((message: any) => {
    console.log('[useChatEvents] handleChatComplete called with message:', message);
    const store = useMessageStore.getState();
    console.log('[useChatEvents] Current messages count:', store.messages.length);
    store.addMessage(message);
    console.log('[useChatEvents] After addMessage, messages count:', useMessageStore.getState().messages.length);
    store.setIsStreaming(false);
    store.setStreamingContent('');
  }, []);

  const handleScrapingStarted = useCallback(() => {
    useMessageStore.getState().setScrapingStatus('scraping');
  }, []);

  const handleScrapingComplete = useCallback(() => {
    useMessageStore.getState().setScrapingStatus('complete');
  }, []);

  const handleScrapingError = useCallback((error: string) => {
    useMessageStore.getState().setScrapingStatus('error');
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

  useEffect(() => {
    if (!conversationId) return;

    console.log('[useChatEvents] Setting up event listeners for conversation:', conversationId);

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      console.log('[useChatEvents] Received chat-stream event:', event.payload);
      console.log('[useChatEvents] Event conversation_id:', event.payload.conversation_id, 'Current:', conversationIdRef.current);
      if (event.payload.conversation_id === conversationIdRef.current) {
        console.log('[useChatEvents] Processing stream chunk');
        handleStreamChunk(event.payload.content);
      } else {
        console.log('[useChatEvents] Ignoring event - ID mismatch');
      }
    });

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      console.log('[useChatEvents] Received chat-complete event:', event.payload);
      console.log('[useChatEvents] Event conversation_id:', event.payload.conversation_id, 'Current:', conversationIdRef.current);
      if (event.payload.conversation_id === conversationIdRef.current) {
        console.log('[useChatEvents] Adding completed message to store');
        handleChatComplete(event.payload.message);
      } else {
        console.log('[useChatEvents] Ignoring event - ID mismatch');
      }
    });

    // Listen for scraping started
    const unlistenScrapingStarted = listen<ScrapingStartedEvent>(
      'scraping-started',
      (event) => {
        if (event.payload.conversation_id === conversationIdRef.current) {
          handleScrapingStarted();
        }
      }
    );

    // Listen for scraping complete
    const unlistenScrapingComplete = listen<ScrapingCompleteEvent>(
      'scraping-complete',
      (event) => {
        if (event.payload.conversation_id === conversationIdRef.current) {
          handleScrapingComplete();
        }
      }
    );

    // Listen for scraping errors
    const unlistenScrapingError = listen<ScrapingErrorEvent>(
      'scraping-error',
      (event) => {
        if (event.payload.conversation_id === conversationIdRef.current) {
          handleScrapingError(event.payload.error);
        }
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

    // Cleanup listeners when component unmounts or conversationId changes
    return () => {
      console.log('[useChatEvents] Cleaning up event listeners for conversation:', conversationId);
      unlistenStream.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenScrapingStarted.then((fn) => fn());
      unlistenScrapingComplete.then((fn) => fn());
      unlistenScrapingError.then((fn) => fn());
      unlistenConversationUpdated.then((fn) => fn());
    };
  }, [
    conversationId,
    handleStreamChunk,
    handleChatComplete,
    handleScrapingStarted,
    handleScrapingComplete,
    handleScrapingError,
    handleConversationUpdated,
  ]);
}

