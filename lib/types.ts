export interface BotSettings {
  enabled: boolean;
  knowledgeBase?: string; // Base64 encoded, can be large
  botPersonality?: string;
  botLanguage?: string;
  customInstructions: string;
  presetQA: Array<{
    id: string;
    question: string;
    answer: string;
    enabled: boolean;
  }>;
  responseStyle: 'professional' | 'friendly' | 'casual' | 'technical' | 'custom';
  autoResponse: boolean;
  responseDelay: number; // in seconds
  presetQuestions: string[];
  presetAnswers: string[];
}

export interface ChatMessage {
  content: string;
  user: string;
  timestamp: Date;
}

export interface ProcessedMessage {
  entityId: string;
  feedId: string;
  content: string;
  user: {
    id: string;
    username?: string;
    name?: string;
  };
  experienceId: string;
  messageType?: 'forumPost' | 'chatMessage';
}

export interface ExperienceData {
  experienceId: string;
  companyId: string;
  timestamp: Date;
}

export interface WebSocketMessage {
  feedEntity?: {
    dmsPost?: any;
    post?: any;
  };
  experience?: {
    id: string;
    bot?: {
      id: string;
    };
  };
}

export interface CompanyExperienceMapping {
  // ... existing code ...
} 