import { useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMessageStore } from '@/stores/messageStore';
import type {
  ChatStreamEvent,
  ChatCompleteEvent,
  ScrapingStartedEvent,
  ScrapingCompleteEvent,
  ScrapingErrorEvent,
} from '@/types';

export function useChatEvents(topicId: string | null) {
  const topicIdRef = useRef(topicId);
  
  // Update ref when topicId changes
  useEffect(() => {
    topicIdRef.current = topicId;
  }, [topicId]);

  // Create stable callback references using useCallback with no dependencies
  // We use refs to access the latest values without re-creating the callbacks
  const handleStreamChunk = useCallback((chunk: string) => {
    useMessageStore.getState().appendStreamingChunk(chunk);
  }, []);

  const handleChatComplete = useCallback((message: any) => {
    const store = useMessageStore.getState();
    store.addMessage(message);
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

  useEffect(() => {
    if (!topicId) return;

    console.log('[useChatEvents] Setting up event listeners for topic:', topicId);

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      if (event.payload.topic_id === topicIdRef.current) {
        handleStreamChunk(event.payload.content);
      }
    });

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      if (event.payload.topic_id === topicIdRef.current) {
        handleChatComplete(event.payload.message);
      }
    });

    // Listen for scraping started
    const unlistenScrapingStarted = listen<ScrapingStartedEvent>(
      'scraping-started',
      (event) => {
        if (event.payload.topic_id === topicIdRef.current) {
          handleScrapingStarted();
        }
      }
    );

    // Listen for scraping complete
    const unlistenScrapingComplete = listen<ScrapingCompleteEvent>(
      'scraping-complete',
      (event) => {
        if (event.payload.topic_id === topicIdRef.current) {
          handleScrapingComplete();
        }
      }
    );

    // Listen for scraping errors
    const unlistenScrapingError = listen<ScrapingErrorEvent>(
      'scraping-error',
      (event) => {
        if (event.payload.topic_id === topicIdRef.current) {
          handleScrapingError(event.payload.error);
        }
      }
    );

    // Cleanup listeners when component unmounts or topicId changes
    return () => {
      console.log('[useChatEvents] Cleaning up event listeners for topic:', topicId);
      unlistenStream.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenScrapingStarted.then((fn) => fn());
      unlistenScrapingComplete.then((fn) => fn());
      unlistenScrapingError.then((fn) => fn());
    };
  }, [
    topicId,
    handleStreamChunk,
    handleChatComplete,
    handleScrapingStarted,
    handleScrapingComplete,
    handleScrapingError,
  ]);
}

