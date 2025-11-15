import { useEffect } from 'react';
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
  const {
    appendStreamingChunk,
    setIsStreaming,
    setScrapingStatus,
    addMessage,
    setStreamingContent,
  } = useMessageStore();

  useEffect(() => {
    if (!topicId) return;

    // Listen for streaming chunks
    const unlistenStream = listen<ChatStreamEvent>('chat-stream', (event) => {
      if (event.payload.topic_id === topicId) {
        appendStreamingChunk(event.payload.content);
      }
    });

    // Listen for chat completion
    const unlistenComplete = listen<ChatCompleteEvent>('chat-complete', (event) => {
      if (event.payload.topic_id === topicId) {
        addMessage(event.payload.message);
        setIsStreaming(false);
        setStreamingContent('');
      }
    });

    // Listen for scraping started
    const unlistenScrapingStarted = listen<ScrapingStartedEvent>(
      'scraping-started',
      (event) => {
        if (event.payload.topic_id === topicId) {
          setScrapingStatus('scraping');
        }
      }
    );

    // Listen for scraping complete
    const unlistenScrapingComplete = listen<ScrapingCompleteEvent>(
      'scraping-complete',
      (event) => {
        if (event.payload.topic_id === topicId) {
          setScrapingStatus('complete');
          // Optionally handle scraped content display
        }
      }
    );

    // Listen for scraping errors
    const unlistenScrapingError = listen<ScrapingErrorEvent>(
      'scraping-error',
      (event) => {
        if (event.payload.topic_id === topicId) {
          setScrapingStatus('error');
          console.error('Scraping error:', event.payload.error);
        }
      }
    );

    // Cleanup listeners
    return () => {
      unlistenStream.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenScrapingStarted.then((fn) => fn());
      unlistenScrapingComplete.then((fn) => fn());
      unlistenScrapingError.then((fn) => fn());
    };
  }, [
    topicId,
    appendStreamingChunk,
    setIsStreaming,
    setScrapingStatus,
    addMessage,
    setStreamingContent,
  ]);
}

