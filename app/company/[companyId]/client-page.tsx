'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Settings, Zap, Brain, MessageSquare, Plus, Trash2, Edit3, Save, X, HelpCircle, BarChart3, Shield } from 'lucide-react';

interface BotSettings {
  enabled: boolean;
  knowledgeBase: string;
  botPersonality?: string;
  customInstructions: string;
  presetQA: Array<{
    id: string;
    question: string;
    answer: string;
    enabled: boolean;
  }>;
  responseStyle: 'professional' | 'friendly' | 'casual' | 'technical' | 'custom';
  autoResponse: boolean;
  responseDelay: number;
}

const GlassCard = ({ children, className = "", delay = 0 }: { 
  children: React.ReactNode; 
  className?: string; 
  delay?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20, scale: 0.95 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    className={`backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl ${className}`}
  >
    {children}
  </motion.div>
);

const ToggleSwitch = ({ 
  checked, 
  onChange, 
  disabled = false 
}: { 
  checked: boolean; 
  onChange: (checked: boolean) => void; 
  disabled?: boolean;
}) => (
  <button
    onClick={() => !disabled && onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 items-center rounded-full transition-colors
      ${disabled 
        ? 'cursor-not-allowed bg-zinc-700' 
        : checked 
          ? 'bg-white' 
          : 'bg-zinc-600'
      }
    `}
    disabled={disabled}
  >
    <span
      className={`
        inline-block h-4 w-4 transform rounded-full transition-transform
        ${disabled 
          ? 'bg-zinc-500' 
          : checked 
            ? 'bg-black translate-x-6' 
            : 'bg-white translate-x-1'
        }
      `}
    />
  </button>
);

const QAItem = ({ 
  qa, 
  onUpdate, 
  onDelete 
}: { 
  qa: { id: string; question: string; answer: string; enabled: boolean };
  onUpdate: (qa: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(qa);

  const handleSave = () => {
    onUpdate(editData);
    setIsEditing(false);
  };

  return (
    <motion.div
      layout
      className="p-4 rounded-xl bg-white/5 border border-white/10"
    >
      <div className="flex items-start justify-between mb-3">
        <ToggleSwitch
          checked={qa.enabled}
          onChange={(enabled) => onUpdate({ ...qa, enabled })}
        />
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="p-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            <Edit3 className="w-4 h-4 text-white" />
          </button>
          <button
            onClick={() => onDelete(qa.id)}
            className="p-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <input
            value={editData.question}
            onChange={(e) => setEditData({ ...editData, question: e.target.value })}
            placeholder="Question"
            className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-white placeholder-zinc-500 focus:outline-none focus:border-white/40"
          />
          <textarea
            value={editData.answer}
            onChange={(e) => setEditData({ ...editData, answer: e.target.value })}
            placeholder="Answer"
            rows={3}
            className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/40"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="px-4 py-2 bg-white/10 text-white rounded-lg font-medium hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h4 className="text-white font-medium mb-2">{qa.question}</h4>
          <p className="text-zinc-400 text-sm">{qa.answer}</p>
        </div>
      )}
    </motion.div>
  );
};

interface ClientPageProps {
  companyId: string;
  isAuthorized: boolean;
  userId: string | null;
}

export default function ClientPage({ companyId, isAuthorized, userId }: ClientPageProps) {
  const [settings, setSettings] = useState<BotSettings>({
    enabled: false,
    knowledgeBase: '',
    botPersonality: '',
    customInstructions: '',
    presetQA: [],
    responseStyle: 'professional',
    autoResponse: true,
    responseDelay: 1
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isAuthorized) {
      loadSettings();
    } else {
      setLoading(false);
    }
  }, [isAuthorized]);

  const loadSettings = async () => {
    try {
      const response = await fetch(`/api/company/${companyId}/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings || settings);
      } else {
        // Parse the error response to get the detailed error message
        try {
          const errorData = await response.json();
          setMessage(errorData.error || 'Failed to load settings');
        } catch (parseError) {
          // If we can't parse the error response, show a generic message
          setMessage('Failed to load settings');
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage('Unable to connect to the server. Please check your internet connection and try again.');
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setLoading(true);
    try {
      const response = await fetch(`/api/company/${companyId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });

      if (response.ok) {
        setMessage('Settings saved successfully!');
        setTimeout(() => setMessage(''), 3000);
      } else {
        // Parse the error response to get the detailed error message
        try {
          const errorData = await response.json();
          setMessage(errorData.error || 'Failed to save settings');
        } catch (parseError) {
          // If we can't parse the error response, show a generic message based on status
          if (response.status === 401) {
            setMessage('You don\'t have permission to save settings for this company.');
          } else if (response.status === 403) {
            setMessage('Access denied. Please check your permissions.');
          } else {
            setMessage('Failed to save settings');
          }
        }
      }
    } catch (error) {
      setMessage('Unable to save settings. Please check your internet connection and try again.');
      console.error('Save error:', error);
    }
    setLoading(false);
    setIsSaving(false);
  };

  const addPresetQA = () => {
    const newQA = {
      id: Date.now().toString(),
      question: '',
      answer: '',
      enabled: true
    };
    setSettings({
      ...settings,
      presetQA: [...settings.presetQA, newQA]
    });
  };

  const updatePresetQA = (updatedQA: any) => {
    setSettings({
      ...settings,
      presetQA: settings.presetQA.map(qa => qa.id === updatedQA.id ? updatedQA : qa)
    });
  };

  const deletePresetQA = (id: string) => {
    setSettings({
      ...settings,
      presetQA: settings.presetQA.filter(qa => qa.id !== id)
    });
  };

  const responseStyles = [
    { value: 'professional', label: 'Professional', desc: 'Formal and business-like responses' },
    { value: 'friendly', label: 'Friendly', desc: 'Warm and approachable tone' },
    { value: 'casual', label: 'Casual', desc: 'Relaxed and conversational' },
    { value: 'technical', label: 'Technical', desc: 'Detailed and precise explanations' },
    { value: 'custom', label: 'Custom', desc: 'Use your own personality settings' }
  ];

  // Show loading state
  if (loading && isAuthorized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white">Loading...</p>
        </div>
      </div>
    );
  }

  // Show unauthorized message for non-admins
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/5 via-black to-zinc-900/5" />
        </div>
        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl shadow-xl p-8 text-center max-w-md"
          >
            <div className="p-4 rounded-2xl bg-red-500/20 border border-red-500/30 mb-6 inline-block">
              <Shield className="w-12 h-12 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">Access Denied</h1>
            <p className="text-zinc-400 mb-6">
              You need to be an authorized admin of this company to configure the AI support bot.
            </p>
            <p className="text-sm text-zinc-500">
              Only company owners and admins can access bot settings.
            </p>
            {userId && (
              <p className="text-xs text-zinc-600 mt-4">
                Authenticated as: {userId}
              </p>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-900/5 via-black to-zinc-900/5" />
      </div>

      <div className="relative z-10 min-h-screen p-6">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <div className="flex items-center justify-center mb-6">
              <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20">
                <Bot className="w-12 h-12 text-white" />
              </div>
            </div>
            <h1 className="text-5xl font-bold text-white mb-4">Whop AI Bot</h1>
            <p className="text-xl text-zinc-400">Bot Configuration Dashboard</p>
            {userId && (
              <p className="text-sm text-zinc-500 mt-2">Authenticated as: {userId}</p>
            )}
          </motion.div>

          {/* Status Message */}
          <AnimatePresence>
            {message && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className={`max-w-2xl mx-auto p-4 rounded-2xl backdrop-blur-xl border text-center font-medium ${
                  message.includes('success')
                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/20 border-red-500/30 text-red-300'
                }`}
              >
                {message}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Content */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            {/* Left Column - Core Settings */}
            <div className="space-y-8">
              {/* Bot Status */}
              <GlassCard className="p-6" delay={0.1}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-xl bg-white/10 mr-4">
                      <Zap className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Bot Status</h2>
                      <p className="text-zinc-400 text-sm">Enable or disable the AI bot</p>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={settings.enabled}
                    onChange={(enabled) => setSettings({...settings, enabled})}
                  />
                </div>

                {settings.enabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-4 pt-4 border-t border-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm">Auto Response</span>
                      <ToggleSwitch
                        checked={settings.autoResponse}
                        onChange={(autoResponse) => setSettings({...settings, autoResponse})}
                      />
                    </div>
                    <div>
                      <label className="text-white text-sm block mb-2">Response Delay (seconds)</label>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={settings.responseDelay}
                        onChange={(e) => setSettings({...settings, responseDelay: parseInt(e.target.value) || 0})}
                        className="w-full bg-black/50 border border-white/20 rounded-lg p-2 text-white focus:outline-none focus:border-white/40"
                      />
                    </div>
                  </motion.div>
                )}
              </GlassCard>

              {/* Response Style */}
              <GlassCard className="p-6" delay={0.2}>
                <div className="flex items-center mb-6">
                  <div className="p-3 rounded-xl bg-white/10 mr-4">
                    <MessageSquare className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Response Style</h2>
                    <p className="text-zinc-400 text-sm">Choose how your AI communicates</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {responseStyles.map((style) => (
                    <label key={style.value} className="flex items-center p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer">
                      <input
                        type="radio"
                        name="responseStyle"
                        value={style.value}
                        checked={settings.responseStyle === style.value}
                        onChange={(e) => setSettings({...settings, responseStyle: e.target.value as any})}
                        className="mr-3 text-white"
                      />
                      <div>
                        <div className="text-white font-medium">{style.label}</div>
                        <div className="text-zinc-400 text-sm">{style.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </GlassCard>
            </div>

            {/* Middle Column - Knowledge Base */}
            <div className="xl:col-span-2 space-y-8">
              {/* Knowledge Base */}
              <GlassCard className="p-6" delay={0.2}>
                <div className="flex items-center mb-6">
                  <div className="p-3 rounded-xl bg-white/10 mr-4">
                    <Brain className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Knowledge Base</h2>
                    <p className="text-zinc-400 text-sm">Core information about your community</p>
                  </div>
                </div>

                <textarea
                  value={settings.knowledgeBase}
                  onChange={(e) => setSettings({...settings, knowledgeBase: e.target.value})}
                  placeholder="Provide detailed information about your community: rules, channels, events, common topics, troubleshooting guides, etc."
                  rows={12}
                  className="w-full bg-black/50 border border-white/20 rounded-lg p-4 text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/40"
                />
                <p className="text-zinc-500 text-xs mt-2">
                  Detailed information helps the AI provide better, more accurate responses.
                </p>
              </GlassCard>

              {/* Custom Personality (Conditional) */}
              {settings.responseStyle === 'custom' && (
                <GlassCard className="p-6" delay={0.3}>
                  <div className="flex items-center mb-6">
                    <div className="p-3 rounded-xl bg-white/10 mr-4">
                      <Brain className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">AI Personality</h2>
                      <p className="text-zinc-400 text-sm">Define your AI's unique character</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <label className="text-white text-sm block mb-2">Personality Description</label>
                      <textarea
                        value={settings.botPersonality}
                        onChange={(e) => setSettings({...settings, botPersonality: e.target.value})}
                        placeholder="e.g., You are a helpful gaming expert who loves competitive FPS games. You're enthusiastic but professional, and you always provide actionable advice..."
                        rows={4}
                        className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/40"
                      />
                    </div>
                    <div>
                      <label className="text-white text-sm block mb-2">Custom Instructions</label>
                      <textarea
                        value={settings.customInstructions}
                        onChange={(e) => setSettings({...settings, customInstructions: e.target.value})}
                        placeholder="Additional instructions for how the AI should behave, format responses, handle specific scenarios..."
                        rows={4}
                        className="w-full bg-black/50 border border-white/20 rounded-lg p-3 text-white placeholder-zinc-500 resize-none focus:outline-none focus:border-white/40"
                      />
                    </div>
                  </div>
                </GlassCard>
              )}

              {/* Preset Q&A */}
              <GlassCard className="p-6" delay={0.4}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-xl bg-white/10 mr-4">
                      <MessageSquare className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">Preset Q&A</h2>
                      <p className="text-zinc-400 text-sm">Perfect answers for common questions</p>
                    </div>
                  </div>
                  <button
                    onClick={addPresetQA}
                    className="p-2 rounded-lg bg-white text-black hover:bg-white/90 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
                  {settings.presetQA.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500">
                      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No preset Q&A yet. Add some to get started!</p>
                    </div>
                  ) : (
                    settings.presetQA.map((qa) => (
                      <QAItem
                        key={qa.id}
                        qa={qa}
                        onUpdate={updatePresetQA}
                        onDelete={deletePresetQA}
                      />
                    ))
                  )}
                </div>
              </GlassCard>
            </div>
          </div>

          {/* Save Button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-center"
          >
            <motion.button
              onClick={saveSettings}
              disabled={loading}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={`relative px-12 py-4 rounded-2xl font-semibold text-lg transition-all duration-300 ${
                loading
                  ? 'bg-white/10 text-zinc-400 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-white/90 shadow-xl'
              }`}
            >
              <AnimatePresence mode="wait">
                {isSaving ? (
                  <motion.div
                    key="saving"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center"
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2"
                    />
                    Saving Configuration...
                  </motion.div>
                ) : (
                  <motion.span
                    key="save"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Save Configuration
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </motion.div>
        </div>
      </div>
    </div>
  );
} 