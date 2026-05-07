import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import {
  AIWorkbench,
  LiveTranscript,
  MeetingTopbar,
  MeetingBottombar,
} from "@/components/meeting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Mic, 
  MicOff, 
  Clock, 
  Check, 
  X, 
  AlertCircle, 
  FileText, 
  Loader2, 
  Download, 
  Upload, 
  Pencil, 
  FileUp,
  Trash2,
  User,
  Plus,
  Brain,
  Timer,
  Sparkles,
  Settings,
  MessageSquare,
  Menu,
  Save,
  FolderOpen,
  History,
  ArrowDown,
  Copy,
  FileDown,
  LogOut,
  ClipboardList,
  CircleCheck,
  CircleX,
  CalendarDays,
  UserCheck,
  Gavel,
  FilePlus2,
  ScrollText,
  Mic2,
  RotateCw,
  Replace,
  Calendar,
  Wrench,
  SlidersHorizontal,
  MoreVertical,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TranscriptSegment, Question, ActionItem, ProposedDecision, MeetingState, MeetingMeta, ExpertRole, Warning, ExtractedRule, UploadedDocument, SeriesSummary, MeetingSeriesRow, MeetingDocument, WordCorrection } from "@shared/schema";
import { expertRoleLabels } from "@shared/schema";
import { apiRequest, authFetch } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SummaryWysiwygEditor, { type SummaryWysiwygEditorRef } from "@/components/SummaryWysiwygEditor";
import { AlertTriangle, FileWarning, BookOpen, ChevronDown, ChevronUp, Lightbulb, PenLine, ListOrdered, ArrowRightLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

const STORAGE_KEY = "meeting-transcription-state";

function formatDeadline(value: string | undefined | null): string {
  if (!value) return "";
  // If it's a YYYY-MM-DD date, format it nicely
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value + "T12:00:00");
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
  }
  return value;
}

function loadFromStorage(): MeetingState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Feil ved lasting fra localStorage:", error);
  }
  return null;
}

function saveToStorage(state: MeetingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Feil ved lagring til localStorage:", error);
  }
}

function clearStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Feil ved sletting fra localStorage:", error);
  }
}

export default function MeetingPage() {
  const { toast } = useToast();
  const [, routeParams] = useRoute<{ id: string }>("/m/:id");
  const routeSessionId = routeParams?.id ? parseInt(routeParams.id, 10) : null;
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [editText, setEditText] = useState("");
  const [annotationText, setAnnotationText] = useState("");
  
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [meetingSummary, setMeetingSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryEditText, setSummaryEditText] = useState("");
  const [isSavingSummaryEdits, setIsSavingSummaryEdits] = useState(false);
  const [isAnalyzingDiff, setIsAnalyzingDiff] = useState(false);
  const [lastLearnedProfile, setLastLearnedProfile] = useState<string | null>(null);
  
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [speakerMappings] = useState<Record<string, string>>({});
  const [expertRole, setExpertRole] = useState<ExpertRole>("bygg");
  const [questionInterval, setQuestionInterval] = useState<number>(1); // minutes: 1, 5, 15, or 0 for manual only
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>("");
  const [showSessionsDialog, setShowSessionsDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameSessionId, setRenameSessionId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState<string>("");
  const [isSavingSession, setIsSavingSession] = useState(false);
  
  // Meeting series state
  const [seriesId, setSeriesId] = useState<number | null>(null);
  const [seriesName, setSeriesName] = useState<string>("");
  const [seriesSummaries, setSeriesSummaries] = useState<SeriesSummary[]>([]);
  const [seriesList, setSeriesList] = useState<(MeetingSeriesRow & { sessionCount: number })[]>([]);
  const [renamingSeriesId, setRenamingSeriesId] = useState<number | null>(null);
  const [renameSeriesValue, setRenameSeriesValue] = useState<string>("");
  const [showCreateSeriesDialog, setShowCreateSeriesDialog] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState<string>("");
  const [isCreatingSeries, setIsCreatingSeries] = useState(false);
  const [saveDialogSeriesId, setSaveDialogSeriesId] = useState<number | null | "new">(null);
  const [saveDialogNewSeriesName, setSaveDialogNewSeriesName] = useState<string>("");
  // Meeting documents (knowledge docs)
  const [meetingKnowledgeDocs, setMeetingKnowledgeDocs] = useState<MeetingDocument[]>([]);
  const [showMeetingDocsDialog, setShowMeetingDocsDialog] = useState(false);
  const [isUploadingMeetingDoc, setIsUploadingMeetingDoc] = useState(false);
  const [meetingDocScope, setMeetingDocScope] = useState<"session" | "series">("session");
  const [meetingDocPastedText, setMeetingDocPastedText] = useState("");
  const [meetingDocPastedName, setMeetingDocPastedName] = useState("");
  const [meetingDocUploadTab, setMeetingDocUploadTab] = useState<"file" | "text">("file");
  const meetingDocFileRef = useRef<HTMLInputElement>(null);

  const [autoScroll, setAutoScroll] = useState(true);
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<"transcript" | "ai">("transcript");
  // Default: OpenAI Whisper. whisper-1 er large-v2 (1.55B parametre) og fanger
  // betydelig mer av rotete møteromslyd enn nb-whisper-medium (769M params).
  // Brukere som vil ha norsk-finetunet transkripsjon kan velge nb-whisper-
  // medium eller -large i Innstillinger.
  const [transcriptionModel, setTranscriptionModel] = useState<"medium" | "large" | "openai">("openai");
  const [transcriptionEngine, setTranscriptionEngine] = useState<string | null>(null);
  const [isCleaningTranscript, setIsCleaningTranscript] = useState(false);
  const [lastTranscriptCleanup, setLastTranscriptCleanup] = useState<Date | null>(null);
  const [meetingMeta, setMeetingMeta] = useState<MeetingMeta>({});
  const [metaOpen, setMetaOpen] = useState(false);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const userScrollingRef = useRef(false);
  
  // Rule checking state
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [isUploadingRule, setIsUploadingRule] = useState(false);
  const [pastedRuleText, setPastedRuleText] = useState("");
  const [isProcessingPastedRule, setIsProcessingPastedRule] = useState(false);
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(new Set());
  const ruleFileInputRef = useRef<HTMLInputElement>(null);
  
  // Proposed action items state
  const [proposedActions, setProposedActions] = useState<ActionItem[]>([]);
  const [approvingAction, setApprovingAction] = useState<ActionItem | null>(null);
  const [approvalText, setApprovalText] = useState("");
  const [confirmingDecision, setConfirmingDecision] = useState<ProposedDecision | null>(null);
  const [confirmingDecisionText, setConfirmingDecisionText] = useState("");
  const [approvalOwner, setApprovalOwner] = useState("");
  const [approvalDeadline, setApprovalDeadline] = useState("");

  // Proposed decisions state
  const [proposedDecisions, setProposedDecisions] = useState<ProposedDecision[]>([]);

  // Manual entry state - actions
  const [showAddAction, setShowAddAction] = useState(false);
  const [addActionText, setAddActionText] = useState("");
  const [addActionOwner, setAddActionOwner] = useState("");
  const [addActionDeadline, setAddActionDeadline] = useState("");

  // Manual entry state - decisions
  const [showAddDecision, setShowAddDecision] = useState(false);
  const [summaryPreviewSessionId, setSummaryPreviewSessionId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ type: "action" | "decision"; id: string; text: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [addDecisionText, setAddDecisionText] = useState("");
  const [addDecisionContext, setAddDecisionContext] = useState("");
  const [addDecisionOwner, setAddDecisionOwner] = useState("");

  // Summary feedback state
  const [summaryFeedbackText, setSummaryFeedbackText] = useState("");
  const [isSubmittingSummaryFeedback, setIsSubmittingSummaryFeedback] = useState(false);

  // Learning dialog state
  const [showLearningDialog, setShowLearningDialog] = useState(false);
  const [learningProfiles, setLearningProfiles] = useState<{
    aiProfile: string;
    aiSignalCount: number;
    aiLastUpdated: string | null;
    summaryProfile: string;
    summaryFeedbackCount: number;
    summaryLastUpdated: string | null;
  } | null>(null);
  const [isLoadingLearning, setIsLoadingLearning] = useState(false);
  
  // Audio file upload state (post-meeting transcription)
  const [showAudioUploadDialog, setShowAudioUploadDialog] = useState(false);
  const [isTranscribingFile, setIsTranscribingFile] = useState(false);
  const [uploadedAudioResult, setUploadedAudioResult] = useState<{
    segments: TranscriptSegment[];
    duration: string;
    totalSeconds: number;
    filename: string;
  } | null>(null);
  const [uploadedFileSummary, setUploadedFileSummary] = useState<string>("");
  const [isGeneratingFileSummary, setIsGeneratingFileSummary] = useState(false);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const summaryEditorRef = useRef<SummaryWysiwygEditorRef>(null);
  const meetingSummaryRef = useRef(meetingSummary);

  // Word corrections state
  const [wordCorrections, setWordCorrections] = useState<WordCorrection[]>([]);
  const [showWordCorrectionsDialog, setShowWordCorrectionsDialog] = useState(false);
  const [newOriginal, setNewOriginal] = useState("");
  const [newCorrected, setNewCorrected] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  // Text selection in transcript for quick correction
  const [selectedTranscriptText, setSelectedTranscriptText] = useState("");
  const [showQuickCorrectionPopup, setShowQuickCorrectionPopup] = useState(false);
  const [quickCorrectionPos, setQuickCorrectionPos] = useState<{ x: number; y: number } | null>(null);
  const [quickCorrectedText, setQuickCorrectedText] = useState("");
  const preSummaryPreviewRef = useRef<string>("");
  
  const queryClient = useQueryClient();
  
  const { data: sessionsData, refetch: refetchSessions } = useQuery<{ sessions: any[] }>({
    queryKey: ["/api/sessions"],
  });
  
  // Fetch rules state
  const { data: rulesData, refetch: refetchRules } = useQuery<{ 
    documents: UploadedDocument[], 
    rules: ExtractedRule[], 
    ruleCount: number 
  }>({
    queryKey: ["/api/rules"],
  });
  
  const uploadedDocuments = rulesData?.documents || [];
  const extractedRules = rulesData?.rules || [];
  const ruleCount = rulesData?.ruleCount || 0;

  // Fetch word corrections
  const { data: wordCorrectionsData, refetch: refetchWordCorrections } = useQuery<{ corrections: WordCorrection[] }>({
    queryKey: ["/api/word-corrections"],
  });
  const wordCorrectionsList = wordCorrectionsData?.corrections || [];

  // Helper: apply word corrections to a text
  const applyWordCorrections = (text: string, corrections: WordCorrection[]): string => {
    if (!corrections.length) return text;
    let result = text;
    for (const c of corrections) {
      // Escape special regex chars, then replace spaces with \s+ to handle variable whitespace
      const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+");
      const regex = new RegExp(`\\b${escaped}\\b`, "gi");
      result = result.replace(regex, c.corrected);
    }
    return result;
  };
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const ruleCheckIntervalRef = useRef<number | null>(null);
  const mobileTranscriptEndRef = useRef<HTMLDivElement>(null);
  const desktopTranscriptEndRef = useRef<HTMLDivElement>(null);
  const lastAnalyzedMinuteRef = useRef(0);
  const lastRuleCheckRef = useRef<string>("");
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const levelAnimFrameRef = useRef<number | null>(null);
  // Continuous PCM capture buffers — replaces MediaRecorder stop/start chunking
  // which left ~100-300ms gaps every 28s and produced WebM fragments that
  // nb-whisper couldn't reliably transcribe.
  const pcmBufferRef = useRef<Float32Array[]>([]);
  const pcmSampleRateRef = useRef<number>(48000);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const [audioLevelBars, setAudioLevelBars] = useState<number[]>(Array(20).fill(0));

  const savedQuestions = questions.filter(q => q.status === "saved");
  const activeQuestions = questions.filter(q => q.status === "new");
  const pendingActions = proposedActions.filter(a => a.status === "proposed");
  const approvedActions = proposedActions.filter(a => a.status === "approved");
  const pendingDecisions = proposedDecisions.filter(d => d.status === "proposed");
  const confirmedDecisions = proposedDecisions.filter(d => d.status === "confirmed");

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) {
      setTranscript(stored.transcript);
      setQuestions(stored.questions);
      if (stored.actionItems) setProposedActions(stored.actionItems);
      if (stored.decisions) setProposedDecisions(stored.decisions);
      setElapsedSeconds(stored.elapsedSeconds);
      setStartTime(stored.startTime);
      if (stored.expertRole) {
        setExpertRole(stored.expertRole);
      }
      if (stored.questionInterval !== undefined) {
        setQuestionInterval(stored.questionInterval);
      }
      if (stored.meetingMeta) {
        setMeetingMeta(stored.meetingMeta);
      }
      if (stored.seriesId) setSeriesId(stored.seriesId);
      if (stored.seriesName) setSeriesName(stored.seriesName);
      if (stored.summary) {
        setMeetingSummary(stored.summary);
        meetingSummaryRef.current = stored.summary;
      }
      if (stored.sessionId) setSessionId(stored.sessionId);
      if (stored.sessionTitle) setSessionTitle(stored.sessionTitle);

      // Backfill: if localStorage has a summary for a saved session, push it to DB
      if (stored.sessionId && stored.summary) {
        authFetch(`/api/sessions/${stored.sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ summary: stored.summary }),
        }).catch(() => {});
      }
      
      if (stored.transcript.length > 0 || stored.questions.length > 0) {
        toast({
          title: "Tidligere møte gjenopprettet",
          description: stored.sessionTitle
            ? `"${stored.sessionTitle}" er gjenopprettet`
            : "Dine data fra forrige økt er tilgjengelige",
        });
      }
    }
  }, []);

  useEffect(() => {
    const state: MeetingState = {
      transcript,
      questions,
      actionItems: proposedActions,
      decisions: proposedDecisions,
      startTime,
      elapsedSeconds,
      speakerMappings,
      expertRole,
      questionInterval,
      sessionId: sessionId ?? undefined,
      sessionTitle: sessionTitle || undefined,
      meetingMeta,
      seriesId: seriesId ?? undefined,
      seriesName: seriesName || undefined,
      summary: meetingSummary || undefined,
    };
    saveToStorage(state);
  }, [transcript, questions, proposedActions, proposedDecisions, startTime, elapsedSeconds, speakerMappings, expertRole, questionInterval, sessionId, sessionTitle, meetingMeta, seriesId, seriesName, meetingSummary]);

  // Rule checking every 10 seconds during recording
  useEffect(() => {
    if (!isRecording || ruleCount === 0) {
      if (ruleCheckIntervalRef.current) {
        clearInterval(ruleCheckIntervalRef.current);
        ruleCheckIntervalRef.current = null;
      }
      return;
    }

    const checkRules = async () => {
      if (transcript.length === 0) return;
      
      // Only analyze the LAST 10 seconds of transcript, not historical violations
      // Since each segment is ~10 seconds of audio, use the last 2 segments max
      const recentSegments = transcript.slice(-2);
      const recentTranscript = recentSegments.map(s => s.text).join(" ");
      
      // Skip if this exact text was already checked
      if (recentTranscript === lastRuleCheckRef.current) return;
      lastRuleCheckRef.current = recentTranscript;
      
      try {
        const response = await authFetch("/api/check-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ transcript: recentTranscript }),
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        if (data.warnings && data.warnings.length > 0) {
          // Add new warnings, avoiding duplicates
          setWarnings(prev => {
            const existingIds = new Set(prev.map(w => w.id));
            const newWarnings = data.warnings.filter((w: Warning) => !existingIds.has(w.id));
            if (newWarnings.length > 0) {
              console.log("Rule check: Adding", newWarnings.length, "new warnings");
              return [...prev, ...newWarnings];
            }
            return prev;
          });
        }
      } catch (error) {
        console.error("Rule check failed:", error);
      }
    };

    // Initial check
    checkRules();
    
    // Check every 10 seconds
    ruleCheckIntervalRef.current = window.setInterval(checkRules, 10000);

    return () => {
      if (ruleCheckIntervalRef.current) {
        clearInterval(ruleCheckIntervalRef.current);
        ruleCheckIntervalRef.current = null;
      }
    };
  }, [isRecording, ruleCount, transcript]);

  // Clean up transcript every 5 minutes (AI corrects obvious transcription errors based on context)
  const cleanTranscriptNow = async (segments: TranscriptSegment[]) => {
    if (segments.length === 0 || isCleaningTranscript) return;
    setIsCleaningTranscript(true);
    try {
      const response = await apiRequest("POST", "/api/clean-transcript", { segments });
      const data = await response.json() as { segments?: TranscriptSegment[] };
      if (data.segments && data.segments.length > 0) {
        setTranscript(data.segments);
        setLastTranscriptCleanup(new Date());
      }
    } catch (err) {
      console.error("Transcript cleanup failed:", err);
    } finally {
      setIsCleaningTranscript(false);
    }
  };

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setTranscript(current => {
        if (current.length > 0) {
          cleanTranscriptNow(current);
        }
        return current;
      });
    }, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(interval);
  }, [isRecording]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const groupQuestionsByMinute = (qs: Question[]) => {
    const groups: { [key: number]: Question[] } = {};
    qs.forEach(q => {
      if (!groups[q.minuteIndex]) {
        groups[q.minuteIndex] = [];
      }
      groups[q.minuteIndex].push(q);
    });
    return groups;
  };

  const scrollToBottom = useCallback(() => {
    if (!autoScroll) return;
    
    // Scroll both mobile and desktop refs - only the visible one will actually scroll
    if (mobileTranscriptEndRef.current) {
      mobileTranscriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
    if (desktopTranscriptEndRef.current) {
      desktopTranscriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [autoScroll]);

  useEffect(() => {
    scrollToBottom();
  }, [transcript, scrollToBottom]);
  
  // Handle scroll events from the actual viewport elements
  const handleScrollEvent = useCallback((scrollContainer: HTMLElement) => {
    const scrollTop = scrollContainer.scrollTop;
    const scrollHeight = scrollContainer.scrollHeight;
    const clientHeight = scrollContainer.clientHeight;
    
    // If user scrolled up (not at bottom)
    if (scrollTop < scrollHeight - clientHeight - 50) {
      if (scrollTop < lastScrollTopRef.current) {
        setAutoScroll(false);
      }
    }
    
    // If scrolled to bottom, re-enable auto-scroll
    if (scrollTop >= scrollHeight - clientHeight - 10) {
      setAutoScroll(true);
    }
    
    lastScrollTopRef.current = scrollTop;
  }, []);

  // Set up scroll listeners for both mobile and desktop scroll areas
  useEffect(() => {
    const setupScrollListener = (ref: React.RefObject<HTMLDivElement>) => {
      if (!ref.current) return null;
      
      // Find the actual scrollable viewport inside ScrollArea
      const viewport = ref.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement;
      if (!viewport) return null;
      
      const handleScroll = () => handleScrollEvent(viewport);
      viewport.addEventListener('scroll', handleScroll, { passive: true });
      
      return () => viewport.removeEventListener('scroll', handleScroll);
    };
    
    const cleanupMobile = setupScrollListener(mobileScrollRef);
    const cleanupDesktop = setupScrollListener(desktopScrollRef);
    
    return () => {
      cleanupMobile?.();
      cleanupDesktop?.();
    };
  }, [handleScrollEvent]);

  // Whisper-modeller (både nb-whisper og OpenAI Whisper) er trent på 16 kHz.
  // Ved å sende 48 kHz får vi 3× større filer og whispers preprocessor må
  // gjøre arbeid som ofte forringer kvaliteten på fjernstemmer. Vi resampler
  // selv med lineær interpolasjon før WAV-encoding.
  const TARGET_SAMPLE_RATE = 16000;

  const downsampleTo16k = (input: Float32Array, inputRate: number): Float32Array => {
    if (inputRate === TARGET_SAMPLE_RATE) return input;
    const ratio = inputRate / TARGET_SAMPLE_RATE;
    const outLength = Math.round(input.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIdx = i * ratio;
      const a = Math.floor(srcIdx);
      const b = Math.min(a + 1, input.length - 1);
      const t = srcIdx - a;
      out[i] = input[a] * (1 - t) + input[b] * t;
    }
    return out;
  };

  // Encode raw mono Float32 PCM samples to a 16-bit WAV blob.
  // Whisper accepts wav/flac/mp3 directly, so this is the cleanest format.
  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);          // PCM chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeStr(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  // Concatenate buffered PCM frames and reset the buffer. Returns null if
  // there's nothing meaningful to send (less than ~0.5s of audio).
  const flushPcmBuffer = (): Blob | null => {
    const frames = pcmBufferRef.current;
    if (frames.length === 0) return null;
    pcmBufferRef.current = [];

    let total = 0;
    for (const f of frames) total += f.length;
    if (total < pcmSampleRateRef.current * 0.5) return null; // <0.5s of audio, skip

    const merged = new Float32Array(total);
    let pos = 0;
    for (const f of frames) {
      merged.set(f, pos);
      pos += f.length;
    }
    const downsampled = downsampleTo16k(merged, pcmSampleRateRef.current);
    return encodeWav(downsampled, TARGET_SAMPLE_RATE);
  };

  // Returns a promise that resolves after the transcribe response has been
  // applied to state. stopRecording awaits this so the final analysis sees
  // the tail audio's transcript too.
  const sendAudioChunk = useCallback((audioBlob: Blob): Promise<void> => {
    return new Promise<void>((resolve) => {
      try {
        setIsProcessing(true);
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(",")[1];
          const mimeType = audioBlob.type;

          try {
            const res = await authFetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ audio: base64Audio, mimeType, model: transcriptionModel }),
            });

            if (!res.ok) {
              let body: any = null;
              try { body = await res.json(); } catch { /* not JSON */ }
              if (body?.code === "ENDPOINT_PAUSED") {
                const modelName = body.model ? `nb-whisper-${body.model}` : "nb-whisper";
                toast({
                  title: `${modelName} er pauset`,
                  description: "Start endepunktet på endpoints.huggingface.co — eller velg OpenAI Whisper i Verktøy-menyen.",
                  variant: "destructive",
                  duration: 15000,
                });
              } else {
                console.error("Transkripsjonsfeil:", res.status, body);
              }
              return;
            }

            const data = (await res.json()) as { segments: TranscriptSegment[]; engine?: string; status?: string };
            if (data.engine) setTranscriptionEngine(data.engine);
            if (data.segments && data.segments.length > 0) {
              const corrected = data.segments.map(s => ({ ...s, text: applyWordCorrections(s.text, wordCorrectionsList) }));
              setTranscript(prev => [...prev, ...corrected]);
            }
          } catch (error) {
            console.error("Transkripsjonsfeil:", error);
          } finally {
            setIsProcessing(false);
            resolve();
          }
        };
        reader.onerror = () => {
          setIsProcessing(false);
          resolve();
        };
      } catch (error) {
        console.error("Feil ved sending av lyd:", error);
        setIsProcessing(false);
        resolve();
      }
    });
  }, []);

  const generateQuestions = useCallback(async (minutesBack: number, isManual: boolean = false) => {
    if (transcript.length === 0) {
      toast({
        title: "Ingen transkript",
        description: "Start et møte eller last opp en lydfil først",
        variant: "destructive",
      });
      return;
    }
    
    setIsGeneratingQuestions(true);
    const currentMinute = Math.floor(elapsedSeconds / 60);
    
    // Get recent transcript based on minutesBack
    const cutoffTime = new Date(Date.now() - minutesBack * 60000);
    const recentSegments = transcript.filter(seg => {
      const segTime = new Date(seg.timestamp);
      return segTime >= cutoffTime;
    });
    
    let recentText: string;
    if (recentSegments.length === 0) {
      // Fallback to last segments if time-based filtering returns nothing
      const lastSegments = transcript.slice(-(minutesBack * 2));
      if (lastSegments.length === 0) {
        setIsGeneratingQuestions(false);
        return;
      }
      recentText = lastSegments.map(s => `${speakerMappings[s.speaker] || s.speaker}: ${s.text}`).join("\n");
    } else {
      recentText = recentSegments.map(s => `${speakerMappings[s.speaker] || s.speaker}: ${s.text}`).join("\n");
    }
    
    const fullText = transcript.map(s => `${speakerMappings[s.speaker] || s.speaker}: ${s.text}`).join("\n");
    
    try {
      // Send existing actions and decisions so AI can deduplicate/update instead of creating new ones
      const existingActionsForAI = proposedActions
        .filter(a => a.status !== "rejected")
        .map(a => ({ id: a.id, text: a.text, suggestedOwner: a.suggestedOwner, suggestedDeadline: a.suggestedDeadline, status: a.status }));
      const existingDecisionsForAI = proposedDecisions
        .filter(d => d.status !== "rejected")
        .map(d => ({ id: d.id, text: d.text, context: d.context, status: d.status }));

      // Fetch fresh series summaries if in a series (only past meetings, not current)
      let freshSeriesSummaries: SeriesSummary[] | undefined;
      if (seriesId) {
        try {
          const seriesRes = await authFetch(`/api/series/${seriesId}/summaries`);
          if (seriesRes.ok) {
            const seriesData = await seriesRes.json();
            // Include all — the backend only returns sessions with saved summaries.
            // If the current session has a summary in DB, including it is harmless since
            // the AI uses it as context for understanding progression, not self-contradiction.
            freshSeriesSummaries = (seriesData.summaries as SeriesSummary[]);
          }
        } catch { /* non-fatal */ }
      }

      const response = await apiRequest("POST", "/api/analyze", { 
        transcript: recentText,
        fullTranscript: fullText,
        expertRole: expertRole,
        existingActions: existingActionsForAI.length > 0 ? existingActionsForAI : undefined,
        existingDecisions: existingDecisionsForAI.length > 0 ? existingDecisionsForAI : undefined,
        seriesSummaries: freshSeriesSummaries && freshSeriesSummaries.length > 0 ? freshSeriesSummaries : undefined,
        sessionId: sessionId ?? undefined,
        seriesId: seriesId ?? undefined,
      });
      const data = await response.json() as { questions: string[], crossMeetingQuestions?: string[], warnings?: Warning[], actions?: Array<{id: string, text: string, suggestedOwner?: string | null, suggestedDeadline?: string | null}>, decisions?: Array<{id: string, text: string, context?: string | null}> };
      
      const newQuestions: Question[] = [];
      if (data.questions && data.questions.length > 0) {
        data.questions.forEach((text, index) => {
          newQuestions.push({
            id: `q-${currentMinute}-${index}-${Date.now()}`,
            text,
            minuteIndex: currentMinute,
            status: "new",
            createdAt: new Date().toISOString(),
            expertRole: expertRole,
            type: "normal",
          });
        });
      }
      if (data.crossMeetingQuestions && data.crossMeetingQuestions.length > 0) {
        data.crossMeetingQuestions.forEach((text, index) => {
          newQuestions.push({
            id: `qx-${currentMinute}-${index}-${Date.now()}`,
            text,
            minuteIndex: currentMinute,
            status: "new",
            createdAt: new Date().toISOString(),
            expertRole: expertRole,
            type: "cross_meeting",
          });
        });
      }
      if (newQuestions.length > 0) {
        setQuestions(prev => [...prev, ...newQuestions]);
        const crossCount = data.crossMeetingQuestions?.length ?? 0;
        const regularCount = data.questions?.length ?? 0;
        toast({
          title: isManual ? "Spørsmål generert manuelt" : "Nye spørsmålsforslag",
          description: `${regularCount} spørsmål${crossCount > 0 ? ` + ${crossCount} kryssreferanse-spørsmål` : ""} fra ${expertRoleLabels[expertRole]}`,
        });
      }
      
      // Handle action items from AI
      if (data.actions && data.actions.length > 0) {
        const incomingActions = data.actions
          .filter(a => a.text && a.text.trim());

        setProposedActions(prev => {
          const existingMap = new Map(prev.map(a => [a.id, a]));
          let addedCount = 0;
          let updatedCount = 0;

          const result = [...prev];
          for (const a of incomingActions) {
            const id = a.id || `action-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            if (existingMap.has(id)) {
              const existing = existingMap.get(id)!;
              // Lock approved/rejected items — AI can refine "proposed" text as more
              // context arrives in later transcript minutes, but once the user has
              // acted on an item it must not change underneath them.
              if (existing.status !== "proposed") continue;
              const idx = result.findIndex(x => x.id === id);
              if (idx !== -1) {
                result[idx] = {
                  ...existing,
                  text: a.text,
                  suggestedOwner: a.suggestedOwner ?? existing.suggestedOwner,
                  suggestedDeadline: a.suggestedDeadline ?? existing.suggestedDeadline,
                };
                updatedCount++;
              }
            } else {
              result.push({
                id,
                text: a.text,
                suggestedOwner: a.suggestedOwner || null,
                suggestedDeadline: a.suggestedDeadline || null,
                status: "proposed" as const,
                minuteIndex: currentMinute,
                createdAt: new Date().toISOString(),
              });
              addedCount++;
            }
          }

          if (addedCount === 0 && updatedCount === 0) return prev;
          return result;
        });

        const addedCount = incomingActions.filter(a => !proposedActions.some(p => p.id === a.id)).length;
        if (addedCount > 0) {
          toast({
            title: `${addedCount} aksjonspunkt${addedCount > 1 ? "er" : ""} foreslått`,
            description: "Godkjenn eller avvis i aksjonspanelet",
          });
        }
      }
      
      // Handle decisions from AI
      if (data.decisions && data.decisions.length > 0) {
        const incomingDecisions = data.decisions.filter((d: any) => d.text && d.text.trim());

        setProposedDecisions(prev => {
          const existingMap = new Map(prev.map(d => [d.id, d]));
          let addedCount = 0;

          const result = [...prev];
          for (const d of incomingDecisions) {
            const id = d.id || `decision-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            if (existingMap.has(id)) {
              const existing = existingMap.get(id)!;
              // Same locking as actions — only refine while still "proposed".
              if (existing.status !== "proposed") continue;
              const idx = result.findIndex(x => x.id === id);
              if (idx !== -1) {
                result[idx] = {
                  ...existing,
                  text: d.text,
                  context: d.context || existing.context,
                };
              }
            } else {
              result.push({
                id,
                text: d.text,
                context: d.context || undefined,
                status: "proposed" as const,
                minuteIndex: currentMinute,
                createdAt: new Date().toISOString(),
              });
              addedCount++;
            }
          }

          if (addedCount === 0 && result.length === prev.length) return prev;
          return result;
        });

        const addedCount = incomingDecisions.filter((d: any) => !proposedDecisions.some(p => p.id === d.id)).length;
        if (addedCount > 0) {
          toast({
            title: `${addedCount} beslutning${addedCount > 1 ? "er" : ""} oppdaget`,
            description: "Bekreft eller avvis i beslutningspanelet",
          });
        }
      }

      // Handle warnings from rule checking
      if (data.warnings && data.warnings.length > 0) {
        setWarnings(prev => {
          const existingIds = new Set(prev.map(w => w.id));
          const newWarnings = data.warnings!.filter(w => !existingIds.has(w.id));
          return [...newWarnings, ...prev]; // New warnings at the top
        });
        
        const violationCount = data.warnings.filter(w => w.level === "violation").length;
        const riskCount = data.warnings.filter(w => w.level === "risk").length;
        
        if (violationCount > 0 || riskCount > 0) {
          toast({
            title: "Regeladvarsler oppdaget",
            description: `${violationCount > 0 ? `${violationCount} brudd` : ""}${violationCount > 0 && riskCount > 0 ? ", " : ""}${riskCount > 0 ? `${riskCount} risiko` : ""}`,
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error("Analysefeil:", error);
      toast({
        title: "Kunne ikke generere spørsmål",
        description: "Det oppstod en feil ved generering av spørsmål",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingQuestions(false);
    }
  }, [elapsedSeconds, transcript, toast, expertRole, speakerMappings]);

  const analyzeAtInterval = useCallback(async () => {
    const currentMinute = Math.floor(elapsedSeconds / 60);
    if (questionInterval === 0 || currentMinute <= lastAnalyzedMinuteRef.current || transcript.length === 0) {
      return;
    }
    
    lastAnalyzedMinuteRef.current = currentMinute;

    // questionInterval controls *how often* AI runs, but the AI always needs
    // a wider context window to catch slow-developing decisions/threads.
    // 10 minutes back gives it enough rope to connect "vi har besluttet..."
    // (minute N) with the actual content (minute N+1) and to refine earlier
    // proposed items.
    await generateQuestions(10, false);
  }, [elapsedSeconds, transcript, questionInterval, generateQuestions]);

  const handleManualGenerate = useCallback(() => {
    generateQuestions(10, true);
  }, [generateQuestions]);

  // Action item handlers
  const startApproval = (action: ActionItem) => {
    setApprovingAction(action);
    setApprovalText(action.text);
    setApprovalOwner(action.suggestedOwner || "");
    // Only pre-fill date if it's a valid YYYY-MM-DD format; otherwise leave blank
    const suggested = action.suggestedDeadline || "";
    setApprovalDeadline(/^\d{4}-\d{2}-\d{2}$/.test(suggested) ? suggested : "");
  };

  const approveAction = () => {
    if (!approvingAction) return;
    const finalText = approvalText.trim() || approvingAction.text;
    setProposedActions(prev => prev.map(a => 
      a.id === approvingAction.id 
        ? { ...a, text: finalText, status: "approved" as const, owner: approvalOwner.trim() || undefined, deadline: approvalDeadline.trim() || undefined }
        : a
    ));
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "action", text: finalText, accepted: true, source: "ai" }) }).catch(console.error);
    setApprovingAction(null);
    setApprovalText("");
    setApprovalOwner("");
    setApprovalDeadline("");
    toast({ title: "Aksjon godkjent", description: "Aksjonspunktet er lagt til aksjonslisten" });
  };

  const rejectAction = (actionId: string) => {
    const action = proposedActions.find(a => a.id === actionId);
    if (action) setRejectTarget({ type: "action", id: actionId, text: action.text });
  };

  const confirmReject = () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (rejectTarget.type === "action") {
      authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "action", text: rejectTarget.text, accepted: false, source: "ai", reason: reason || undefined }) }).catch(console.error);
      setProposedActions(prev => prev.map(a => a.id === rejectTarget.id ? { ...a, status: "rejected" as const } : a));
    } else {
      authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision", text: rejectTarget.text, accepted: false, source: "ai", reason: reason || undefined }) }).catch(console.error);
      setProposedDecisions(prev => prev.map(d => d.id === rejectTarget.id ? { ...d, status: "rejected" as const } : d));
    }
    setRejectTarget(null);
    setRejectReason("");
  };

  const removeApprovedAction = (actionId: string) => {
    setProposedActions(prev => prev.filter(a => a.id !== actionId));
  };

  // Decision handlers
  const confirmDecision = (decision: ProposedDecision) => {
    setConfirmingDecision(decision);
    setConfirmingDecisionText(decision.text);
  };

  const doConfirmDecision = () => {
    if (!confirmingDecision) return;
    const finalText = confirmingDecisionText.trim() || confirmingDecision.text;
    setProposedDecisions(prev => prev.map(d =>
      d.id === confirmingDecision.id
        ? { ...d, text: finalText, status: "confirmed" as const, confirmedAt: new Date().toISOString() }
        : d
    ));
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision", text: finalText, context: confirmingDecision.context, accepted: true, source: "ai" }) }).catch(console.error);
    setConfirmingDecision(null);
    setConfirmingDecisionText("");
    toast({ title: "Beslutning bekreftet", description: "Beslutningen er lagt til beslutningslisten" });
  };

  const rejectDecision = (decisionId: string) => {
    const decision = proposedDecisions.find(d => d.id === decisionId);
    if (decision) setRejectTarget({ type: "decision", id: decisionId, text: decision.text });
  };

  // Inline approve/confirm handlers — used by new ActionCard / DecisionCard
  // components. Bypasses the modal flow.
  const inlineApproveAction = (id: string, edits: { text: string; owner: string; deadline: string }) => {
    const finalText = edits.text.trim();
    setProposedActions(prev => prev.map(a =>
      a.id === id
        ? { ...a, text: finalText || a.text, status: "approved" as const, owner: edits.owner.trim() || undefined, deadline: edits.deadline.trim() || undefined }
        : a
    ));
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "action", text: finalText || "", accepted: true, source: "ai" }) }).catch(console.error);
    toast({ title: "Aksjon godkjent" });
  };

  const inlineConfirmDecision = (id: string, edits: { text: string }) => {
    const finalText = edits.text.trim();
    let context: string | undefined;
    setProposedDecisions(prev => prev.map(d => {
      if (d.id !== id) return d;
      context = d.context;
      return { ...d, text: finalText || d.text, status: "confirmed" as const, confirmedAt: new Date().toISOString() };
    }));
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision", text: finalText || "", context, accepted: true, source: "ai" }) }).catch(console.error);
    toast({ title: "Beslutning bekreftet" });
  };

  const inlineAddAction = (fields: { text: string; owner: string; deadline: string }) => {
    if (!fields.text.trim()) return;
    const newAction: ActionItem = {
      id: `a-manual-${Date.now()}`,
      text: fields.text.trim(),
      suggestedOwner: fields.owner.trim() || null,
      suggestedDeadline: fields.deadline.trim() || null,
      status: "approved" as const,
      source: "manual" as const,
      owner: fields.owner.trim() || undefined,
      deadline: fields.deadline.trim() || undefined,
      minuteIndex: Math.floor(elapsedSeconds / 60),
      createdAt: new Date().toISOString(),
    };
    setProposedActions(prev => [...prev, newAction]);
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "action", text: newAction.text, accepted: true, source: "manual" }) }).catch(console.error);
    toast({ title: "Aksjon lagt til" });
  };

  const inlineAddDecision = (fields: { text: string; owner: string; context: string }) => {
    if (!fields.text.trim()) return;
    const newDecision: ProposedDecision = {
      id: `d-manual-${Date.now()}`,
      text: fields.text.trim(),
      context: fields.context.trim() || undefined,
      owner: fields.owner.trim() || undefined,
      status: "confirmed" as const,
      source: "manual" as const,
      confirmedAt: new Date().toISOString(),
      minuteIndex: Math.floor(elapsedSeconds / 60),
      createdAt: new Date().toISOString(),
    };
    setProposedDecisions(prev => [...prev, newDecision]);
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision", text: newDecision.text, context: newDecision.context, accepted: true, source: "manual" }) }).catch(console.error);
    toast({ title: "Beslutning lagt til" });
  };

  // Manual add handlers
  const addActionManually = () => {
    if (!addActionText.trim()) return;
    const newAction: ActionItem = {
      id: `a-manual-${Date.now()}`,
      text: addActionText.trim(),
      suggestedOwner: addActionOwner.trim() || null,
      suggestedDeadline: addActionDeadline.trim() || null,
      status: "approved" as const,
      source: "manual" as const,
      owner: addActionOwner.trim() || undefined,
      deadline: addActionDeadline.trim() || undefined,
      minuteIndex: Math.floor(elapsedSeconds / 60),
      createdAt: new Date().toISOString(),
    };
    setProposedActions(prev => [...prev, newAction]);
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "action", text: newAction.text, accepted: true, source: "manual" }) }).catch(console.error);
    setAddActionText("");
    setAddActionOwner("");
    setAddActionDeadline("");
    setShowAddAction(false);
    toast({ title: "Aksjon lagt til", description: "Manuelt aksjonspunkt er lagt til listen" });
  };

  const addDecisionManually = () => {
    if (!addDecisionText.trim()) return;
    const newDecision: ProposedDecision = {
      id: `d-manual-${Date.now()}`,
      text: addDecisionText.trim(),
      context: addDecisionContext.trim() || undefined,
      owner: addDecisionOwner.trim() || undefined,
      status: "confirmed" as const,
      source: "manual" as const,
      confirmedAt: new Date().toISOString(),
      minuteIndex: Math.floor(elapsedSeconds / 60),
      createdAt: new Date().toISOString(),
    };
    setProposedDecisions(prev => [...prev, newDecision]);
    authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "decision", text: newDecision.text, context: newDecision.context, accepted: true, source: "manual" }) }).catch(console.error);
    setAddDecisionText("");
    setAddDecisionContext("");
    setAddDecisionOwner("");
    setShowAddDecision(false);
    toast({ title: "Beslutning lagt til", description: "Manuell beslutning er lagt til listen" });
  };

  const submitSummaryFeedback = async () => {
    if (!summaryFeedbackText.trim()) return;
    setIsSubmittingSummaryFeedback(true);
    try {
      const summaryExcerpt = meetingSummary ? meetingSummary.slice(0, 400) : undefined;
      const res = await authFetch("/api/feedback/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentText: summaryFeedbackText.trim(), summaryExcerpt }),
      });
      if (!res.ok) {
        toast({ title: "Kunne ikke sende tilbakemelding", description: "Prøv igjen", variant: "destructive" });
        return;
      }
      setSummaryFeedbackText("");
      toast({ title: "Takk for tilbakemeldingen!", description: "AI-en vil bruke dette til å forbedre fremtidige referater" });
    } catch (err) {
      console.error("Error submitting summary feedback:", err);
      toast({ title: "Feil ved innsending", description: "Sjekk tilkoblingen og prøv igjen", variant: "destructive" });
    } finally {
      setIsSubmittingSummaryFeedback(false);
    }
  };

  const saveSummaryEdits = async () => {
    const originalSummary = meetingSummary;
    const editedSummary = (summaryEditorRef.current?.getMarkdown() ?? summaryEditText).trim();
    if (!editedSummary) return;
    const targetSessionId = summaryPreviewSessionId !== null ? summaryPreviewSessionId : sessionId;
    const targetTitle = summaryPreviewSessionId !== null
      ? (sessionsData?.sessions?.find((s: any) => s.id === summaryPreviewSessionId)?.title || `Møte #${summaryPreviewSessionId}`)
      : sessionTitle;
    setIsSavingSummaryEdits(true);
    try {
      setMeetingSummary(editedSummary);
      meetingSummaryRef.current = editedSummary;
      setIsEditingSummary(false);
      if (targetSessionId) {
        await apiRequest("PATCH", `/api/sessions/${targetSessionId}`, { summary: editedSummary });
        refetchSessions();
      }

      const hasChanged = originalSummary.trim() !== editedSummary.trim();
      if (hasChanged && originalSummary.length > 50) {
        // Run structured diff analysis and profile update (this is the "memory" system)
        // Do it async so we don't block the user — show a background toast
        setIsAnalyzingDiff(true);
        authFetch("/api/feedback/summary-diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ original: originalSummary, edited: editedSummary, sessionTitle: targetTitle }),
        })
          .then(r => r.json())
          .then((data: { ok: boolean; analysis: string; profileText: string }) => {
            if (data.profileText) {
              setLastLearnedProfile(data.profileText);
              toast({
                title: "AI lærte av redigeringen din",
                description: "Preferansene er oppdatert. Neste referat vil bruke det du lærte den nå.",
                duration: 6000,
              });
            }
          })
          .catch(console.error)
          .finally(() => setIsAnalyzingDiff(false));
      }

      toast({ title: "Referat lagret", description: hasChanged ? "Endringer lagret og sendt til AI for læring" : "Ingen endringer — ingenting å lagre" });
    } catch (err) {
      console.error("Error saving summary edits:", err);
      toast({ title: "Feil ved lagring", description: "Prøv igjen", variant: "destructive" });
    } finally {
      setIsSavingSummaryEdits(false);
    }
  };

  const openLearningDialog = async () => {
    setShowLearningDialog(true);
    setIsLoadingLearning(true);
    try {
      const res = await authFetch("/api/learning/profiles");
      if (res.ok) {
        const data = await res.json();
        setLearningProfiles(data);
      }
    } catch (err) {
      console.error("Error loading learning profiles:", err);
    } finally {
      setIsLoadingLearning(false);
    }
  };

  const removeConfirmedDecision = (decisionId: string) => {
    setProposedDecisions(prev => prev.filter(d => d.id !== decisionId));
  };

  // Move an action over to the decisions column. Carries the text + owner
  // along; resets to "proposed" so the user can confirm it as a decision.
  const moveActionToDecision = (actionId: string) => {
    const action = proposedActions.find(a => a.id === actionId);
    if (!action) return;
    const moved: ProposedDecision = {
      id: `d-moved-${Date.now()}`,
      text: action.text,
      context: action.suggestedDeadline ? `Frist: ${action.suggestedDeadline}` : undefined,
      owner: action.owner || action.suggestedOwner || undefined,
      status: "proposed" as const,
      source: action.source ?? "ai",
      minuteIndex: action.minuteIndex,
      createdAt: new Date().toISOString(),
    };
    setProposedActions(prev => prev.filter(a => a.id !== actionId));
    setProposedDecisions(prev => [...prev, moved]);
    toast({ title: "Flyttet til beslutninger", description: action.text });
  };

  const moveDecisionToAction = (decisionId: string) => {
    const decision = proposedDecisions.find(d => d.id === decisionId);
    if (!decision) return;
    const moved: ActionItem = {
      id: `a-moved-${Date.now()}`,
      text: decision.text,
      suggestedOwner: decision.owner ?? null,
      suggestedDeadline: null,
      status: "proposed" as const,
      source: decision.source ?? "ai",
      owner: decision.owner,
      deadline: undefined,
      minuteIndex: decision.minuteIndex,
      createdAt: new Date().toISOString(),
    };
    setProposedDecisions(prev => prev.filter(d => d.id !== decisionId));
    setProposedActions(prev => [...prev, moved]);
    toast({ title: "Flyttet til aksjoner", description: decision.text });
  };

  useEffect(() => {
    // Only auto-generate if interval is set (not manual-only mode)
    if (isRecording && elapsedSeconds > 0 && questionInterval > 0) {
      const intervalSeconds = questionInterval * 60;
      if (elapsedSeconds % intervalSeconds === 0) {
        analyzeAtInterval();
      }
    }
  }, [elapsedSeconds, isRecording, questionInterval, analyzeAtInterval]);

  useEffect(() => {
    fetchMeetingKnowledgeDocs();
  }, [sessionId, seriesId]);

  const startRecording = async () => {
    if (isStartingRecording) return; // Prevent double-clicks
    try {
      setMicrophoneError(null);
      setIsStartingRecording(true);

      // Check for secure context and mediaDevices support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const isSecure = window.isSecureContext;
        throw new Error(
          isSecure
            ? "Nettleseren din støtter ikke mikrofonopptak. Prøv Chrome eller Safari."
            : "Mikrofonopptak krever sikker tilkobling (HTTPS). Prøv den publiserte versjonen av appen."
        );
      }
      
      // Simplified audio constraints for better iOS Safari compatibility
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Browser-side audio processing — store/conf-rooms har ofte stemmer
          // langt fra mikrofonen, så vi vil ha alle disse av-default på.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      
      streamRef.current = stream;

      // Single AudioContext drives both the visualizer and the PCM capture pipeline.
      // Continuous capture via a ScriptProcessor avoids the ~100-300ms gaps that
      // MediaRecorder.stop()/start() left every 28s, plus produces clean WAV that
      // nb-whisper transcribes more reliably than mid-stream WebM fragments.
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      pcmSampleRateRef.current = audioCtx.sampleRate;
      pcmBufferRef.current = [];

      const source = audioCtx.createMediaStreamSource(stream);
      audioSourceRef.current = source;

      // Visualizer branch
      try {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.7;
        source.connect(analyser);
        analyserRef.current = analyser;
        audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);

        const NUM_BARS = 20;
        const animate = () => {
          if (!analyserRef.current || !audioDataRef.current) return;
          analyserRef.current.getByteFrequencyData(audioDataRef.current);
          const data = audioDataRef.current;
          const bars: number[] = [];
          const binCount = data.length;
          for (let i = 0; i < NUM_BARS; i++) {
            const mirroredIdx = i < NUM_BARS / 2 ? i : NUM_BARS - 1 - i;
            const binIdx = Math.floor((mirroredIdx / (NUM_BARS / 2)) * Math.min(binCount - 1, 14));
            const raw = data[binIdx] / 255;
            bars.push(Math.max(raw, 0.03 + Math.random() * 0.06));
          }
          setAudioLevelBars(bars);
          levelAnimFrameRef.current = requestAnimationFrame(animate);
        };
        levelAnimFrameRef.current = requestAnimationFrame(animate);
      } catch {
        // Visualizer not critical
      }

      // PCM capture branch — copies each onaudioprocess buffer into a list of
      // Float32Arrays. flushPcmBuffer() merges and encodes them as WAV.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        pcmBufferRef.current.push(new Float32Array(ch)); // copy — getChannelData returns a view
      };
      source.connect(processor);
      // ScriptProcessor only fires onaudioprocess if it's connected to the destination.
      processor.connect(audioCtx.destination);

      console.log(`Lydopptak: ${audioCtx.sampleRate}Hz mono PCM → WAV`);

      setIsStartingRecording(false);
      setIsRecording(true);
      setTranscriptionEngine(transcriptionModel === "openai" ? "openai-whisper" : `nb-whisper-${transcriptionModel}`);
      setStartTime(new Date().toISOString());
      lastAnalyzedMinuteRef.current = 0;

      // Every 28s, flush the buffered PCM as a WAV chunk and send for transcription.
      // No gap — ScriptProcessor keeps capturing while we slice the buffer.
      // 28s (not 30) avoids repetition artifacts at the Whisper training boundary.
      recordingIntervalRef.current = window.setInterval(() => {
        try {
          const wavBlob = flushPcmBuffer();
          if (wavBlob) sendAudioChunk(wavBlob);
        } catch (intervalError) {
          console.error("Audio chunk error:", intervalError);
        }
      }, 28000);
      
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
      
      toast({
        title: "Opptak startet",
        description: "Møtetranskripsjonen er nå aktiv",
      });
      
    } catch (error: any) {
      console.error("Mikrofonfeil:", error);
      setIsStartingRecording(false);
      // Norske, handlingsrettede feilmeldinger basert på error.name først.
      // (error.message er ofte engelsk: "Permission denied", "Permission dismissed".)
      let errorMsg: string;
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
      if (error?.name === "NotAllowedError" || /denied|dismissed/i.test(error?.message ?? "")) {
        errorMsg = isMac
          ? "Mikrofontilgang er blokkert. Klikk på 🔒-ikonet i adresselinjen og tillat mikrofon, eller gå til Systeminnstillinger → Personvern og sikkerhet → Mikrofon → tillat Chrome."
          : "Mikrofontilgang er blokkert. Klikk på 🔒-ikonet i adresselinjen og velg «Tillat» for mikrofon, deretter last siden på nytt.";
      } else if (error?.name === "NotFoundError") {
        errorMsg = "Ingen mikrofon funnet. Sjekk at en mikrofon er koblet til datamaskinen.";
      } else if (error?.name === "NotReadableError") {
        errorMsg = "Mikrofonen er i bruk av et annet program (f.eks. Zoom eller Teams). Lukk det og prøv igjen.";
      } else if (error?.message) {
        errorMsg = error.message;
      } else {
        errorMsg = "Kunne ikke få tilgang til mikrofonen. Sjekk at den er koblet til og at du har gitt tillatelse.";
      }
      setMicrophoneError(errorMsg);
      toast({
        title: "Kunne ikke starte opptak",
        description: errorMsg,
        variant: "destructive",
        duration: 10000,
      });
    }
  };

  const stopRecording = async () => {
    // Clear the recording interval first so no new chunks are scheduled
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    // Clear rule check interval
    if (ruleCheckIntervalRef.current) {
      clearInterval(ruleCheckIntervalRef.current);
      ruleCheckIntervalRef.current = null;
    }

    // Flush any in-progress audio BEFORE tearing down the pipeline so the tail
    // of the meeting (whatever has been said since the last 28s tick) gets
    // transcribed too. Disconnecting the processor first stops new frames from
    // arriving so the buffer is stable when we read it.
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch { /* already disconnected */ }
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      try { audioSourceRef.current.disconnect(); } catch { /* already disconnected */ }
      audioSourceRef.current = null;
    }

    const tailBlob = flushPcmBuffer();
    let tailPromise: Promise<void> | null = null;
    if (tailBlob) {
      console.log(`Sender siste lydklipp (${(tailBlob.size / 1024).toFixed(1)} KB)`);
      tailPromise = sendAudioChunk(tailBlob);
    }

    // Schedule a FINAL ANALYSIS pass once the tail has been transcribed. We
    // don't block stopRecording on it — the user gets immediate UI feedback
    // ("Opptak stoppet"), and the final AI pass runs in the background and
    // populates any last-minute decisions/actions/refinements once it's done.
    (async () => {
      try {
        if (tailPromise) await tailPromise;
        // Pass 999 = "include the entire meeting" so the AI can do its
        // review-pass over every proposed item with full context.
        await generateQuestions(999, false);
        toast({ title: "Sluttanalyse fullført", description: "AI har gjennomgått hele møtet." });
      } catch (e) {
        console.error("Final analyze failed:", e);
      }
    })();

    // Legacy MediaRecorder fallback in case anything still holds a reference
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === "recording") mediaRecorderRef.current.stop();
      } catch { /* ignore */ }
      mediaRecorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (levelAnimFrameRef.current) {
      cancelAnimationFrame(levelAnimFrameRef.current);
      levelAnimFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    audioDataRef.current = null;
    setAudioLevelBars(Array(20).fill(0));
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    setIsRecording(false);
    
    toast({
      title: "Opptak stoppet",
      description: `Møtet varte i ${formatTime(elapsedSeconds)}`,
    });
  };

  // --- Word corrections handlers ---
  const handleAddWordCorrection = async () => {
    if (!newOriginal.trim() || !newCorrected.trim()) return;
    setIsSavingCorrection(true);
    try {
      await apiRequest("POST", "/api/word-corrections", { original: newOriginal.trim(), corrected: newCorrected.trim() });
      setNewOriginal("");
      setNewCorrected("");
      refetchWordCorrections();
    } catch (e) {
      toast({ title: "Feil", description: "Kunne ikke lagre ordkorrigering", variant: "destructive" });
    } finally {
      setIsSavingCorrection(false);
    }
  };

  const handleDeleteWordCorrection = async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/word-corrections/${id}`);
      refetchWordCorrections();
    } catch (e) {
      toast({ title: "Feil", description: "Kunne ikke slette ordkorrigering", variant: "destructive" });
    }
  };

  const handleTranscriptMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setShowQuickCorrectionPopup(false);
      return;
    }
    // Normalize: collapse any whitespace/newlines into single spaces
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) {
      setShowQuickCorrectionPopup(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setSelectedTranscriptText(text);
    setQuickCorrectedText(text);
    setQuickCorrectionPos({ x: rect.left + rect.width / 2, y: rect.top + window.scrollY - 8 });
    setShowQuickCorrectionPopup(true);
  };

  const handleSaveQuickCorrection = async () => {
    if (!selectedTranscriptText || !quickCorrectedText.trim()) return;
    setIsSavingCorrection(true);
    try {
      await apiRequest("POST", "/api/word-corrections", { original: selectedTranscriptText, corrected: quickCorrectedText.trim() });
      refetchWordCorrections();
      // Retroactively fix existing transcript
      const escapedSel = selectedTranscriptText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+");
      setTranscript(prev => prev.map(s => ({
        ...s,
        text: s.text.replace(new RegExp(`\\b${escapedSel}\\b`, "gi"), quickCorrectedText.trim())
      })));
      toast({ title: "Korrigering lagret", description: `"${selectedTranscriptText}" → "${quickCorrectedText.trim()}" vil gjelde fremover` });
    } catch (e) {
      toast({ title: "Feil", description: "Kunne ikke lagre korrigering", variant: "destructive" });
    } finally {
      setIsSavingCorrection(false);
      setShowQuickCorrectionPopup(false);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleSaveQuestion = (questionId: string) => {
    setQuestions(prev => 
      prev.map(q => 
        q.id === questionId ? { ...q, status: "saved" as const } : q
      )
    );
  };

  const handleDeleteQuestion = (questionId: string) => {
    setQuestions(prev => 
      prev.map(q => 
        q.id === questionId ? { ...q, status: "deleted" as const } : q
      )
    );
  };

  const handleRemoveSavedQuestion = (questionId: string) => {
    setQuestions(prev => 
      prev.map(q => 
        q.id === questionId ? { ...q, status: "deleted" as const } : q
      )
    );
  };

  const handleEditQuestion = (question: Question) => {
    setEditingQuestion(question);
    setEditText(question.text);
    setAnnotationText(question.annotation || "");
  };

  const handleSaveEdit = () => {
    if (editingQuestion) {
      setQuestions(prev =>
        prev.map(q =>
          q.id === editingQuestion.id
            ? { ...q, text: editText, annotation: annotationText || undefined }
            : q
        )
      );
      setEditingQuestion(null);
      setEditText("");
      setAnnotationText("");
      
      toast({
        title: "Spørsmål oppdatert",
        description: "Endringene dine er lagret",
      });
    }
  };

  const exportTranscriptAsTxt = () => {
    if (transcript.length === 0) {
      toast({
        title: "Ingen transkript å eksportere",
        description: "Start et møte for å opprette et transkript",
        variant: "destructive",
      });
      return;
    }
    
    let content = `MØTETRANSKRIPT\n`;
    content += `Dato: ${new Date().toLocaleDateString("no-NO")}\n`;
    content += `Varighet: ${formatTime(elapsedSeconds)}\n`;
    content += `${"=".repeat(50)}\n\n`;
    
    transcript.forEach(segment => {
      const time = new Date(segment.timestamp).toLocaleTimeString("no-NO", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const speakerName = speakerMappings[segment.speaker] || segment.speaker;
      content += `[${time}] ${speakerName}:\n${segment.text}\n\n`;
    });
    
    if (savedQuestions.length > 0) {
      content += `\n${"=".repeat(50)}\n`;
      content += `LAGREDE SPØRSMÅL\n`;
      content += `${"=".repeat(50)}\n\n`;
      
      savedQuestions.forEach((q, index) => {
        content += `${index + 1}. ${q.text}\n`;
        if (q.annotation) {
          content += `   Notat: ${q.annotation}\n`;
        }
        content += `\n`;
      });
    }
    
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `motetranskript-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({
      title: "Eksport fullført",
      description: "Transkriptet er lastet ned som TXT-fil",
    });
  };

  // Keep ref in sync so generateSummary always reads the latest value
  useEffect(() => { meetingSummaryRef.current = meetingSummary; }, [meetingSummary]);

  const printSummaryAsPdf = (markdownText: string, title?: string) => {
    const htmlContent = marked.parse(markdownText) as string;
    const dateStr = new Date().toLocaleDateString('nb-NO');
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      toast({ title: "Pop-ups er blokkert", description: "Tillat pop-ups og prøv igjen.", variant: "destructive" });
      return;
    }
    printWindow.document.write(`<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><title>${title || 'Møtereferat'} – ${dateStr}</title><style>*,*::before,*::after{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.6;color:#1a1a1a;margin:0;padding:20mm}h1{font-size:20pt;font-weight:700;margin:0 0 16px;color:#111;border-bottom:2px solid #333;padding-bottom:8px}h2{font-size:14pt;font-weight:700;margin:24px 0 8px;color:#111;border-bottom:1px solid #ccc;padding-bottom:4px}h3{font-size:12pt;font-weight:600;margin:16px 0 6px;color:#222}p{margin:6px 0}ul,ol{margin:6px 0;padding-left:20px}li{margin:3px 0}strong{font-weight:600}em{font-style:italic}table{width:100%;border-collapse:collapse;margin:10px 0;font-size:10pt}th{background:#f0f0f0;font-weight:600;text-align:left;padding:6px 10px;border:1px solid #ccc}td{padding:5px 10px;border:1px solid #ddd;vertical-align:top}tr:nth-child(even) td{background:#fafafa}blockquote{border-left:3px solid #ccc;margin:8px 0;padding:4px 12px;color:#555}hr{border:none;border-top:1px solid #ccc;margin:16px 0}@media print{body{padding:0}h2{page-break-after:avoid}table{page-break-inside:avoid}}</style></head><body>${htmlContent}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 400);
  };

  const generateSummary = async (forceRegenerate = false) => {
    if (transcript.length === 0) {
      toast({
        title: "Ingen transkript å oppsummere",
        description: "Start et møte for å opprette et transkript",
        variant: "destructive",
      });
      return;
    }

    // Check BOTH the ref and the state value: the ref may not yet be updated
    // if the user clicks immediately after state has been restored from localStorage
    // (React paints before effects run, so there is a brief window where the state
    // is correct but the ref hasn't been synced yet by the useEffect below).
    if ((meetingSummaryRef.current || meetingSummary) && !forceRegenerate) {
      // Also make sure the ref is populated so future ref-reads are consistent
      if (!meetingSummaryRef.current && meetingSummary) {
        meetingSummaryRef.current = meetingSummary;
      }
      setShowSummaryDialog(true);
      return;
    }
    
    setIsGeneratingSummary(true);
    setShowSummaryDialog(true);
    
    try {
      const transcriptText = transcript.map(s => {
        const speakerName = speakerMappings[s.speaker] || s.speaker;
        const time = new Date(s.timestamp).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `[${time}] ${speakerName}: ${s.text}`;
      }).join("\n");
      const savedQuestionTexts = savedQuestions.map(q => q.text);
      
      // Build metadata — user-provided fields take priority over auto-detected
      const autoParticipants = Array.from(new Set(transcript.map(s => speakerMappings[s.speaker] || s.speaker)));
      const autoDate = startTime ? new Date(startTime).toLocaleDateString('nb-NO') : new Date().toLocaleDateString('nb-NO');
      const autoTime = startTime ? new Date(startTime).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : undefined;

      // Parse user-provided participants (comma/newline separated) or fall back to auto-detected
      const userParticipants = meetingMeta.participants
        ? meetingMeta.participants.split(/[,\n]+/).map(p => p.trim()).filter(Boolean)
        : undefined;

      const metadata = {
        meeting_title: meetingMeta.title || undefined,
        project: meetingMeta.project || undefined,
        client: meetingMeta.client || undefined,
        date: meetingMeta.date || autoDate,
        time: meetingMeta.time || autoTime,
        location: meetingMeta.location || undefined,
        meeting_leader: meetingMeta.meetingLeader || undefined,
        secretary: meetingMeta.secretary || undefined,
        participants: userParticipants ?? (autoParticipants.length > 0 ? autoParticipants : undefined),
        absent: meetingMeta.absent || undefined,
        duration_minutes: Math.floor(elapsedSeconds / 60),
      };
      
      const approvedActionItems = proposedActions
        .filter(a => a.status === "approved")
        .map(a => ({ text: a.text, owner: a.owner, deadline: a.deadline }));

      const pendingActionItems = proposedActions
        .filter(a => a.status === "proposed")
        .map(a => ({ text: a.text, suggestedOwner: a.suggestedOwner, suggestedDeadline: a.suggestedDeadline }));

      const confirmedDecisionItems = proposedDecisions
        .filter(d => d.status === "confirmed")
        .map(d => ({ text: d.text, context: d.context }));

      // Fetch series summaries from previous meetings for cross-meeting contradiction analysis in the referat
      let summarySeriesSummaries: SeriesSummary[] | undefined;
      if (seriesId) {
        try {
          const seriesRes = await authFetch(`/api/series/${seriesId}/summaries`);
          if (seriesRes.ok) {
            const seriesData = await seriesRes.json();
            // Exclude the current session (if it has a saved summary) to avoid self-reference
            const all = seriesData.summaries as SeriesSummary[];
            summarySeriesSummaries = all.length > 0 ? all : undefined;
          }
        } catch { /* non-fatal */ }
      }
      
      const response = await apiRequest("POST", "/api/summary", {
        transcript: transcriptText,
        savedQuestions: savedQuestionTexts,
        seriesSummaries: summarySeriesSummaries,
        approvedActions: approvedActionItems.length > 0 ? approvedActionItems : undefined,
        pendingActions: pendingActionItems.length > 0 ? pendingActionItems : undefined,
        confirmedDecisions: confirmedDecisionItems.length > 0 ? confirmedDecisionItems : undefined,
        metadata,
      });
      
      const data = await response.json() as { summary: string };
      setMeetingSummary(data.summary);
      meetingSummaryRef.current = data.summary;
      // Auto-save summary to DB — always await so we know if it failed
      if (sessionId) {
        try {
          await apiRequest("PATCH", `/api/sessions/${sessionId}`, { summary: data.summary });
          refetchSessions();
        } catch (saveErr) {
          console.error("Feil ved lagring av referat til DB:", saveErr);
          toast({
            title: "Advarsel: Referat ikke lagret i databasen",
            description: "Referatet er lagret lokalt, men kunne ikke lagres i databasen. Prøv å lagre møtet på nytt.",
            variant: "destructive",
          });
        }
      } else {
        // No session yet — warn user that the summary will be lost without saving
        toast({
          title: "Referat generert",
          description: "Husk å lagre møtet (Lagre-knappen) for å bevare referatet permanent i databasen.",
        });
      }
    } catch (error) {
      console.error("Sammendragsfeil:", error);
      setMeetingSummary("Kunne ikke generere sammendrag. Vennligst prøv igjen.");
      toast({
        title: "Feil ved generering av sammendrag",
        description: "Det oppstod en feil. Vennligst prøv igjen.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Audio file upload and transcription
  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Reset file input
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = "";
    }
    
    setIsTranscribingFile(true);
    setUploadedAudioResult(null);
    setUploadedFileSummary("");
    
    try {
      const formData = new FormData();
      formData.append("audio", file);
      
      const response = await authFetch("/api/transcribe-file", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Feil ved transkripsjon");
      }
      
      const data = await response.json();
      
      setUploadedAudioResult({
        segments: data.segments,
        duration: data.duration,
        totalSeconds: data.totalSeconds || 0,
        filename: data.filename,
      });
      
      toast({
        title: "Transkripsjon fullført",
        description: `${data.segments.length} segmenter transkribert fra ${file.name}`,
      });
      
    } catch (error: any) {
      console.error("Audio file transcription error:", error);
      let errorMessage = error.message || "Kunne ikke transkribere lydfilen";
      
      // Check for file size error from OpenAI
      if (errorMessage.includes("Maximum content size") || errorMessage.includes("26214400")) {
        errorMessage = "Filen er for stor (maks 25 MB). Prøv å komprimere filen eller del den opp i mindre deler.";
      }
      
      toast({
        title: "Feil ved transkripsjon",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsTranscribingFile(false);
    }
  };
  
  const generateFileSummary = async () => {
    if (!uploadedAudioResult || uploadedAudioResult.segments.length === 0) {
      toast({
        title: "Ingen transkript",
        description: "Last opp en lydfil først",
        variant: "destructive",
      });
      return;
    }
    
    setIsGeneratingFileSummary(true);
    
    try {
      const transcriptText = uploadedAudioResult.segments.map(s => {
        return `[${s.timestamp}] ${s.speaker}: ${s.text}`;
      }).join("\n");
      
      const metadata = {
        date: new Date().toLocaleDateString('nb-NO'),
        duration_minutes: Math.max(1, Math.round(uploadedAudioResult.totalSeconds / 60)),
        duration_seconds: Math.round(uploadedAudioResult.totalSeconds),
        filename: uploadedAudioResult.filename,
      };
      
      const response = await apiRequest("POST", "/api/summary", {
        transcript: transcriptText,
        savedQuestions: [],
        metadata,
      });
      
      const data = await response.json() as { summary: string };
      setUploadedFileSummary(data.summary);
      
    } catch (error) {
      console.error("Summary error:", error);
      setUploadedFileSummary("Kunne ikke generere sammendrag. Vennligst prøv igjen.");
      toast({
        title: "Feil ved generering av sammendrag",
        description: "Det oppstod en feil. Vennligst prøv igjen.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingFileSummary(false);
    }
  };
  
  const loadUploadedToMeeting = () => {
    if (!uploadedAudioResult) return;
    
    // Load the uploaded transcript into the main meeting view
    setTranscript(uploadedAudioResult.segments);
    setQuestions([]);
    setElapsedSeconds(0);
    setMeetingSummary("");
    setWarnings([]);
    setSessionId(null);
    setSessionTitle("");
    
    if (uploadedFileSummary) {
      setMeetingSummary(uploadedFileSummary);
    }
    
    setShowAudioUploadDialog(false);
    
    toast({
      title: "Transkript lastet",
      description: "Du kan nå redigere og generere referat fra transkriptet",
    });
  };

  const fetchMeetingKnowledgeDocs = async () => {
    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", String(sessionId));
    if (seriesId) params.set("seriesId", String(seriesId));
    if (!sessionId && !seriesId) return;
    try {
      const res = await authFetch(`/api/meeting-documents?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMeetingKnowledgeDocs(data.documents || []);
      }
    } catch { /* non-fatal */ }
  };

  const uploadMeetingDoc = async (file?: File) => {
    if (!sessionId && !seriesId) {
      toast({ title: "Lagre møtet først", description: "Du må lagre møtet eller velge en serie før du kan laste opp dokumenter", variant: "destructive" });
      return;
    }
    setIsUploadingMeetingDoc(true);
    try {
      const formData = new FormData();
      if (meetingDocScope === "session" && sessionId) formData.set("sessionId", String(sessionId));
      if (meetingDocScope === "series" && seriesId) formData.set("seriesId", String(seriesId));
      
      if (meetingDocUploadTab === "text") {
        if (!meetingDocPastedText.trim()) { toast({ title: "Ingen tekst å laste opp", variant: "destructive" }); return; }
        formData.set("text", meetingDocPastedText);
        formData.set("filename", meetingDocPastedName || "Innlimt tekst");
      } else if (file) {
        formData.set("document", file);
      } else {
        return;
      }

      const res = await authFetch("/api/meeting-documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: "Dokument lastet opp", description: `"${data.document.originalName}" er indeksert` });
        setMeetingDocPastedText("");
        setMeetingDocPastedName("");
        await fetchMeetingKnowledgeDocs();
      } else {
        toast({ title: "Opplasting feilet", description: data.error || "Ukjent feil", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Opplasting feilet", variant: "destructive" });
    } finally {
      setIsUploadingMeetingDoc(false);
    }
  };

  const deleteMeetingDoc = async (id: number) => {
    try {
      const res = await authFetch(`/api/meeting-documents/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMeetingKnowledgeDocs(prev => prev.filter(d => d.id !== id));
        toast({ title: "Dokument slettet" });
      }
    } catch { toast({ title: "Kunne ikke slette", variant: "destructive" }); }
  };

  const openSaveDialog = async () => {
    if (transcript.length === 0 && questions.length === 0) {
      toast({
        title: "Ingenting å lagre",
        description: "Start et møte eller last opp en lydfil først",
        variant: "destructive",
      });
      return;
    }
    
    // Fetch series list for picker
    try {
      const res = await authFetch("/api/series");
      if (res.ok) {
        const data = await res.json();
        setSeriesList(data.series || []);
      }
    } catch { /* non-fatal */ }

    // If already saved, just update
    if (sessionId) {
      saveSession(sessionTitle || `Møte ${new Date().toLocaleDateString('nb-NO')}`);
    } else {
      // Suggest a default name based on series
      const defaultTitle = seriesName 
        ? `${seriesName} – ${new Date().toLocaleDateString('nb-NO')}`
        : `Møte ${new Date().toLocaleDateString('nb-NO')} ${new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}`;
      setSessionTitle(defaultTitle);
      setSaveDialogSeriesId(seriesId);
      setSaveDialogNewSeriesName("");
      setShowSaveDialog(true);
    }
  };
  
  const saveSession = async (title: string, chosenSeriesId?: number | null | "new", newSeriesNameArg?: string) => {
    setIsSavingSession(true);
    setShowSaveDialog(false);
    
    // Resolve series — create new if needed
    let resolvedSeriesId: number | null = null;
    let resolvedSeriesName = seriesName;
    if (chosenSeriesId === "new" && newSeriesNameArg?.trim()) {
      try {
        const seriesRes = await apiRequest("POST", "/api/series", { name: newSeriesNameArg.trim() });
        const seriesData = await seriesRes.json() as { series: MeetingSeriesRow };
        resolvedSeriesId = seriesData.series.id;
        resolvedSeriesName = seriesData.series.name;
      } catch {
        toast({ title: "Kunne ikke opprette møteserie", variant: "destructive" });
      }
    } else if (typeof chosenSeriesId === "number" && chosenSeriesId > 0) {
      resolvedSeriesId = chosenSeriesId;
      resolvedSeriesName = seriesList.find(s => s.id === chosenSeriesId)?.name ?? "";
    } else if (chosenSeriesId === null || chosenSeriesId === undefined) {
      // Keep current series if not explicitly changing
      resolvedSeriesId = seriesId;
    }

    if (resolvedSeriesId !== seriesId) {
      setSeriesId(resolvedSeriesId);
      setSeriesName(resolvedSeriesName);
    }
    
    try {
      if (sessionId) {
        await apiRequest("PATCH", `/api/sessions/${sessionId}`, {
          title,
          transcript,
          questions,
          actionItems: proposedActions,
          decisions: proposedDecisions,
          elapsedSeconds,
          speakerMappings,
          expertRole,
          questionInterval,
          summary: meetingSummary || undefined,
          seriesId: resolvedSeriesId,
          seriesName: resolvedSeriesName || null,
        });
        
        setSessionTitle(title);
        toast({
          title: "Sesjon oppdatert",
          description: resolvedSeriesName ? `Lagret i serien "${resolvedSeriesName}"` : "Møtet er lagret i databasen",
        });
      } else {
        // Compute series index (number of sessions already in this series + 1)
        let seriesIndex: number | null = null;
        if (resolvedSeriesId) {
          try {
            const siRes = await authFetch(`/api/series/${resolvedSeriesId}/summaries`);
            if (siRes.ok) {
              const siData = await siRes.json();
              seriesIndex = (siData.summaries?.length ?? 0) + 1;
            }
          } catch { /* non-fatal */ }
        }

        const response = await apiRequest("POST", "/api/sessions", {
          title,
          expertRole,
          questionInterval,
          seriesId: resolvedSeriesId,
          seriesIndex,
          seriesName: resolvedSeriesName || null,
        });
        
        const data = await response.json() as { session: { id: number } };
        const newSessionId = data.session.id;
        setSessionId(newSessionId);
        setSessionTitle(title);
        
        await apiRequest("PATCH", `/api/sessions/${newSessionId}`, {
          transcript,
          questions,
          actionItems: proposedActions,
          decisions: proposedDecisions,
          elapsedSeconds,
          speakerMappings,
          seriesId: resolvedSeriesId,
          seriesIndex,
          seriesName: resolvedSeriesName || null,
          summary: meetingSummaryRef.current || undefined,
        });
        
        toast({
          title: "Sesjon lagret",
          description: resolvedSeriesName ? `"${title}" lagret i serien "${resolvedSeriesName}"` : `"${title}" er lagret`,
        });
      }
      
      refetchSessions();
    } catch (error) {
      console.error("Feil ved lagring av sesjon:", error);
      toast({
        title: "Kunne ikke lagre sesjon",
        description: "Det oppstod en feil ved lagring",
        variant: "destructive",
      });
    } finally {
      setIsSavingSession(false);
    }
  };
  
  const renameSession = async () => {
    if (!renameSessionId || !renameTitle.trim()) return;
    
    try {
      await apiRequest("PATCH", `/api/sessions/${renameSessionId}`, {
        title: renameTitle.trim(),
      });
      
      if (sessionId === renameSessionId) {
        setSessionTitle(renameTitle.trim());
      }
      
      toast({
        title: "Navn endret",
        description: "Møtenavnet er oppdatert",
      });
      
      setShowRenameDialog(false);
      setRenameSessionId(null);
      setRenameTitle("");
      refetchSessions();
    } catch (error) {
      console.error("Feil ved endring av navn:", error);
      toast({
        title: "Kunne ikke endre navn",
        description: "Det oppstod en feil",
        variant: "destructive",
      });
    }
  };

  const loadSession = async (id: number) => {
    try {
      const response = await apiRequest("GET", `/api/sessions/${id}`);
      const data = await response.json() as { session: any };
      const session = data.session;
      
      setTranscript(session.transcript || []);
      setQuestions(session.questions || []);
      setProposedActions(session.actionItems || []);
      setProposedDecisions(session.decisions || []);
      setElapsedSeconds(session.elapsedSeconds || 0);
      if (session.expertRole) setExpertRole(session.expertRole);
      if (session.questionInterval !== undefined) setQuestionInterval(session.questionInterval);
      setMeetingSummary(session.summary || "");
      meetingSummaryRef.current = session.summary || "";
      setSessionId(id);
      setSessionTitle(session.title || "");
      setShowSessionsDialog(false);
      
      toast({
        title: "Sesjon lastet",
        description: `Møte "${session.title}" er lastet inn`,
      });
    } catch (error) {
      console.error("Feil ved lasting av sesjon:", error);
      toast({
        title: "Kunne ikke laste sesjon",
        description: "Det oppstod en feil ved lasting",
        variant: "destructive",
      });
    }
  };

  // Auto-load session when navigating to /m/:id (e.g. from history or home)
  useEffect(() => {
    if (routeSessionId && routeSessionId !== sessionId) {
      loadSession(routeSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId]);

  const deleteSession = async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/sessions/${id}`);
      refetchSessions();
      
      if (sessionId === id) {
        setSessionId(null);
      }
      
      toast({
        title: "Sesjon slettet",
        description: "Møtet er fjernet fra databasen",
      });
    } catch (error) {
      console.error("Feil ved sletting av sesjon:", error);
      toast({
        title: "Kunne ikke slette sesjon",
        description: "Det oppstod en feil ved sletting",
        variant: "destructive",
      });
    }
  };

  const logout = async () => {
    try {
      const { supabase } = await import("@/lib/supabase");
      await supabase.auth.signOut();
      // App.tsx's onAuthStateChange listener flips state and shows the login
      // page; no manual redirect needed.
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const validTypes = ["audio/mp3", "audio/mpeg", "audio/wav", "audio/webm", "audio/m4a", "audio/mp4"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|webm|m4a|mp4)$/i)) {
      toast({
        title: "Ugyldig filtype",
        description: "Vennligst last opp en lydfil (MP3, WAV, WEBM, M4A)",
        variant: "destructive",
      });
      return;
    }
    
    if (file.size > 25 * 1024 * 1024) {
      toast({
        title: "Filen er for stor",
        description: "Maksimal filstørrelse er 25 MB",
        variant: "destructive",
      });
      return;
    }
    
    setIsUploadingFile(true);
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(",")[1];
        
        try {
          const response = await apiRequest("POST", "/api/transcribe", { audio: base64Audio, model: transcriptionModel });
          const data = await response.json() as { segments: TranscriptSegment[] };
          
          if (data.segments && data.segments.length > 0) {
            const corrected = data.segments.map(s => ({ ...s, text: applyWordCorrections(s.text, wordCorrectionsList) }));
            setTranscript(prev => [...prev, ...corrected]);
            
            toast({
              title: "Fil transkribert",
              description: `${data.segments.length} segmenter lagt til transkriptet`,
            });
          }
        } catch (error) {
          console.error("Transkripsjonsfeil:", error);
          toast({
            title: "Transkripsjonsfeil",
            description: "Kunne ikke transkribere lydfilen",
            variant: "destructive",
          });
        } finally {
          setIsUploadingFile(false);
        }
      };
    } catch (error) {
      console.error("Filopplastingsfeil:", error);
      setIsUploadingFile(false);
      toast({
        title: "Opplastingsfeil",
        description: "Kunne ikke laste opp filen",
        variant: "destructive",
      });
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRuleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const validTypes = ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(pdf|txt|docx)$/i)) {
      toast({
        title: "Ugyldig filtype",
        description: "Vennligst last opp et regeldokument (PDF, TXT eller DOCX)",
        variant: "destructive",
      });
      return;
    }
    
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "Filen er for stor",
        description: "Maksimal filstørrelse er 10 MB",
        variant: "destructive",
      });
      return;
    }
    
    // Check document limit
    if (uploadedDocuments.length >= 5) {
      toast({
        title: "Maks antall dokumenter nådd",
        description: "Du kan laste opp maks 5 dokumenter. Slett et dokument først.",
        variant: "destructive",
      });
      return;
    }
    
    setIsUploadingRule(true);
    
    try {
      const formData = new FormData();
      formData.append("document", file);
      
      const response = await authFetch("/api/rules/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Opplastingsfeil");
      }
      
      const data = await response.json();
      
      refetchRules();
      
      toast({
        title: "Dokument analysert",
        description: `${data.rules?.length || 0} regler trukket ut fra ${file.name}`,
      });
    } catch (error: any) {
      console.error("Regelopplasting feilet:", error);
      toast({
        title: "Opplastingsfeil",
        description: error.message || "Kunne ikke laste opp regeldokumentet",
        variant: "destructive",
      });
    } finally {
      setIsUploadingRule(false);
      if (ruleFileInputRef.current) {
        ruleFileInputRef.current.value = "";
      }
    }
  };
  
  const deleteRuleDocument = async (documentId: string) => {
    try {
      await apiRequest("DELETE", `/api/rules/document/${documentId}`);
      refetchRules();
      
      toast({
        title: "Dokument fjernet",
        description: "Dokumentet og tilhørende regler er slettet",
      });
    } catch (error) {
      console.error("Feil ved sletting av dokument:", error);
      toast({
        title: "Slettingsfeil",
        description: "Kunne ikke slette dokumentet",
        variant: "destructive",
      });
    }
  };
  
  const clearAllRules = async () => {
    try {
      await apiRequest("DELETE", "/api/rules");
      refetchRules();
      setWarnings([]);
      
      toast({
        title: "Alle regler slettet",
        description: "Alle dokumenter og regler er fjernet",
      });
    } catch (error) {
      console.error("Feil ved sletting av regler:", error);
      toast({
        title: "Slettingsfeil",
        description: "Kunne ikke slette reglene",
        variant: "destructive",
      });
    }
  };
  
  const handlePastedRuleText = async () => {
    if (!pastedRuleText.trim()) {
      toast({
        title: "Tom tekst",
        description: "Vennligst lim inn tekst med regler først",
        variant: "destructive",
      });
      return;
    }
    
    if (uploadedDocuments.length >= 5) {
      toast({
        title: "Maks antall dokumenter nådd",
        description: "Du kan laste opp maks 5 dokumenter. Slett et dokument først.",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessingPastedRule(true);
    
    try {
      const response = await apiRequest("POST", "/api/rules/text", {
        text: pastedRuleText,
        name: `Innlimt tekst ${new Date().toLocaleDateString("nb-NO")}`,
      });
      
      const data = await response.json();
      
      refetchRules();
      setPastedRuleText("");
      
      toast({
        title: "Tekst analysert",
        description: `${data.rules?.length || 0} regler trukket ut fra innlimt tekst`,
      });
    } catch (error: any) {
      console.error("Tekstanalyse feilet:", error);
      toast({
        title: "Analysefeil",
        description: error.message || "Kunne ikke analysere teksten",
        variant: "destructive",
      });
    } finally {
      setIsProcessingPastedRule(false);
    }
  };
  
  const toggleWarningExpanded = (warningId: string) => {
    setExpandedWarnings(prev => {
      const newSet = new Set(prev);
      if (newSet.has(warningId)) {
        newSet.delete(warningId);
      } else {
        newSet.add(warningId);
      }
      return newSet;
    });
  };
  
  const dismissWarning = (warningId: string) => {
    setWarnings(prev => prev.filter(w => w.id !== warningId));
  };

  const clearMeeting = () => {
    setTranscript([]);
    setQuestions([]);
    setProposedActions([]);
    setProposedDecisions([]);
    setWarnings([]);
    setElapsedSeconds(0);
    setStartTime(null);
    setTranscriptionEngine(null);
    setMeetingMeta({});
    setMeetingSummary("");
    meetingSummaryRef.current = "";
    lastAnalyzedMinuteRef.current = 0;
    clearStorage();
    
    toast({
      title: "Møte nullstilt",
      description: "Alle data er slettet",
    });
  };

  const newMeeting = () => {
    const hasUnsavedData = (transcript.length > 0 || questions.length > 0) && !sessionId;
    if (hasUnsavedData && !window.confirm("Start nytt møte? Ulagrede data vil gå tapt.")) return;
    setTranscript([]);
    setQuestions([]);
    setProposedActions([]);
    setProposedDecisions([]);
    setWarnings([]);
    setElapsedSeconds(0);
    setStartTime(null);
    setTranscriptionEngine(null);
    setMeetingMeta({});
    setSessionId(null);
    setSessionTitle("");
    setSeriesId(null);
    setSeriesName("");
    setMeetingSummary("");
    meetingSummaryRef.current = "";
    setMeetingKnowledgeDocs([]);
    lastAnalyzedMinuteRef.current = 0;
    clearStorage();
    toast({ title: "Nytt møte klar", description: "Start opptaket når du er klar" });
  };

  const groupedActiveQuestions = groupQuestionsByMinute(activeQuestions);
  const sortedMinutes = Object.keys(groupedActiveQuestions)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className="flex-1 min-h-0 bg-background flex flex-col overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        className="hidden"
        data-testid="input-file-upload"
      />

      <MeetingTopbar
        title={sessionTitle}
        onTitleChange={setSessionTitle}
        elapsedSeconds={elapsedSeconds}
        isRecording={isRecording}
        isProcessing={isProcessing}
        transcriptionEngine={transcriptionEngine}
        onGenerateSummary={() => generateSummary()}
        isGeneratingSummary={isGeneratingSummary}
        hasSummary={!!meetingSummary}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Flere handlinger" className="shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={newMeeting} disabled={isRecording}>
                <FilePlus2 className="h-4 w-4 mr-2" />Nytt møte
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={openSaveDialog}
                disabled={isSavingSession || (transcript.length === 0 && questions.length === 0)}
              >
                {isSavingSession ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {sessionId ? "Oppdater" : "Lagre møtet"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSessionsDialog(true)}>
                <History className="h-4 w-4 mr-2" />Tidligere møter
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowAudioUploadDialog(true)}>
                <Mic2 className="h-4 w-4 mr-2" />Importer lydopptak
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportTranscriptAsTxt} disabled={transcript.length === 0}>
                <Download className="h-4 w-4 mr-2" />Eksporter transkript
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleManualGenerate}
                disabled={transcript.length === 0 || isGeneratingQuestions}
              >
                {isGeneratingQuestions ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generer spørsmål nå
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { fetchMeetingKnowledgeDocs(); setShowMeetingDocsDialog(true); }}>
                <FolderOpen className="h-4 w-4 mr-2" />Møtedokumenter
                {meetingKnowledgeDocs.length > 0 ? <span className="ml-auto text-xs text-muted-foreground">{meetingKnowledgeDocs.length}</span> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Møteinformasjon (collapsible) */}
      <div className="shrink-0 border-b border-border bg-muted/20">
        <button
          type="button"
          onClick={() => setMetaOpen(prev => !prev)}
          className="w-full flex items-center justify-between px-4 sm:px-6 py-2 text-xs font-medium text-muted-foreground hover-elevate"
        >
          <span className="inline-flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" />
            Møteinformasjon
            {(meetingMeta.title || meetingMeta.project || meetingMeta.meetingLeader) ? (
              <span className="rounded-full bg-success/15 text-success px-2 py-0.5 text-[10px] font-medium">
                Utfylt
              </span>
            ) : null}
          </span>
          {metaOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {metaOpen ? (
          <div className="px-4 sm:px-6 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: "Møtetittel", key: "title" as const, ph: "F.eks. Byggemøte uke 15", span: "md:col-span-2 lg:col-span-3" },
              { label: "Prosjekt", key: "project" as const, ph: "Prosjektnavn" },
              { label: "Kunde", key: "client" as const, ph: "Kunde / oppdragsgiver" },
              { label: "Sted", key: "location" as const, ph: "F.eks. Byggeplass, Teams" },
              { label: "Møteleder", key: "meetingLeader" as const, ph: "Navn" },
              { label: "Referent", key: "secretary" as const, ph: "Navn (valgfritt)" },
              { label: "Deltakere", key: "participants" as const, ph: "Navn, kommaseparert" },
              { label: "Fraværende", key: "absent" as const, ph: "Navn, kommaseparert" },
            ].map(f => (
              <div key={f.key} className={f.span ?? ""}>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
                <Input
                  placeholder={f.ph}
                  value={(meetingMeta as any)[f.key] || ""}
                  onChange={e => setMeetingMeta(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="h-9 text-sm bg-card"
                />
              </div>
            ))}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Dato</label>
              <Input
                type="date"
                value={meetingMeta.date || ""}
                onChange={e => setMeetingMeta(prev => ({ ...prev, date: e.target.value }))}
                className="h-9 text-sm bg-card [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Tid</label>
              <Input
                type="time"
                value={meetingMeta.time || ""}
                onChange={e => setMeetingMeta(prev => ({ ...prev, time: e.target.value }))}
                className="h-9 text-sm bg-card [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Microphone error banner */}
      {microphoneError ? (
        <div className="shrink-0 mx-4 sm:mx-6 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{microphoneError}</p>
        </div>
      ) : null}

      {/* Mobile workspace tab toggle */}
      <div className="lg:hidden shrink-0 border-b border-border px-3 pt-2">
        <Tabs
          value={mobileWorkspaceTab}
          onValueChange={(v) => setMobileWorkspaceTab(v as "transcript" | "ai")}
        >
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="transcript" className="gap-2">
              <FileText className="h-3.5 w-3.5" />
              Transkript
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              AI
              {(pendingActions.length + pendingDecisions.length + warnings.length) > 0 ? (
                <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0 text-[10px] font-semibold ml-1">
                  {pendingActions.length + pendingDecisions.length + warnings.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main work area */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,42%)_minmax(0,58%)] overflow-hidden">
        <div className={"min-h-0 flex flex-col " + (mobileWorkspaceTab === "transcript" ? "" : "hidden lg:flex")}>
          <LiveTranscript
            ref={desktopScrollRef}
            segments={transcript}
            isRecording={isRecording}
            isCleaning={isCleaningTranscript}
            audioLevels={audioLevelBars}
            onCleanTranscript={() => cleanTranscriptNow(transcript)}
            onSelectionChange={handleTranscriptMouseUp}
            endRef={desktopTranscriptEndRef}
          />
        </div>
        <div className={"min-h-0 flex flex-col " + (mobileWorkspaceTab === "ai" ? "" : "hidden lg:flex")}>
          <AIWorkbench
            pendingActions={pendingActions}
            approvedActions={approvedActions}
            pendingDecisions={pendingDecisions}
            confirmedDecisions={confirmedDecisions}
            savedQuestions={savedQuestions}
            groupedActiveQuestions={groupedActiveQuestions}
            sortedMinutes={sortedMinutes}
            warnings={warnings}
            isRecording={isRecording}
            expertRole={expertRole}
            onApproveAction={inlineApproveAction}
            onRejectAction={rejectAction}
            onMoveActionToDecision={moveActionToDecision}
            onRemoveApprovedAction={removeApprovedAction}
            onAddActionManually={inlineAddAction}
            onConfirmDecision={inlineConfirmDecision}
            onRejectDecision={rejectDecision}
            onMoveDecisionToAction={moveDecisionToAction}
            onRemoveConfirmedDecision={removeConfirmedDecision}
            onAddDecisionManually={inlineAddDecision}
            onSaveQuestion={handleSaveQuestion}
            onDeleteQuestion={handleDeleteQuestion}
            onEditQuestion={handleEditQuestion}
            onRemoveSavedQuestion={handleRemoveSavedQuestion}
            onDismissWarning={dismissWarning}
            className="h-full"
          />
        </div>
      </div>

      <MeetingBottombar
        isRecording={isRecording}
        isStartingRecording={isStartingRecording}
        onToggleRecording={() => isRecording ? stopRecording() : startRecording()}
        expertRole={expertRole}
        onExpertRoleChange={setExpertRole}
        questionInterval={questionInterval}
        onQuestionIntervalChange={setQuestionInterval}
        transcriptionModel={transcriptionModel}
        onTranscriptionModelChange={setTranscriptionModel}
        audioLevels={audioLevelBars}
      />

      <Dialog open={!!editingQuestion} onOpenChange={() => setEditingQuestion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rediger spørsmål</DialogTitle>
            <DialogDescription>
              Endre teksten eller legg til et notat til spørsmålet
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Spørsmål</label>
              <Input
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                placeholder="Skriv spørsmålet her..."
                data-testid="input-edit-question"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notat (valgfritt)</label>
              <Textarea
                value={annotationText}
                onChange={(e) => setAnnotationText(e.target.value)}
                placeholder="Legg til et notat..."
                rows={3}
                data-testid="input-edit-annotation"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingQuestion(null)}>
              Avbryt
            </Button>
            <Button onClick={handleSaveEdit} data-testid="button-save-edit">
              Lagre endringer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSummaryDialog} onOpenChange={(open) => { setShowSummaryDialog(open); if (!open) { setIsEditingSummary(false); setSummaryEditText(""); if (summaryPreviewSessionId !== null) { const restored = preSummaryPreviewRef.current; setMeetingSummary(restored); meetingSummaryRef.current = restored; setSummaryPreviewSessionId(null); preSummaryPreviewRef.current = ""; } } }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle className="text-xl font-semibold">Møtereferat</DialogTitle>
                <DialogDescription className="text-sm mt-1">
                  {isEditingSummary
                    ? "Rediger referatet direkte — endringer lagres og AI-en lærer av dem"
                    : summaryPreviewSessionId !== null && summaryPreviewSessionId !== sessionId
                      ? (() => { const s = sessionsData?.sessions?.find((s: any) => s.id === summaryPreviewSessionId); return s ? `${s.title || `Møte #${s.id}`} — ${new Date(s.startedAt).toLocaleDateString('nb-NO')}` : "Tidligere møte"; })()
                      : "AI-generert referat basert på transkripsjonen"}
                </DialogDescription>
              </div>
              {!isGeneratingSummary && meetingSummary && !isEditingSummary && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => generateSummary(true)}
                    disabled={transcript.length === 0}
                    data-testid="button-regenerate-summary"
                    className="gap-2 text-muted-foreground"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Regenerer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditingSummary(true);
                    }}
                    data-testid="button-edit-summary"
                    className="gap-2"
                  >
                    <Pencil className="h-4 w-4" />
                    Rediger
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(meetingSummary);
                      toast({
                        title: "Kopiert",
                        description: "Referatet er kopiert til utklippstavlen",
                      });
                    }}
                    data-testid="button-copy-summary"
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Kopier
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      const element = document.getElementById('summary-content');
                      if (!element) return;

                      const printWindow = window.open('', '_blank', 'width=900,height=700');
                      if (!printWindow) {
                        toast({
                          title: "Feil ved PDF-generering",
                          description: "Pop-ups er blokkert. Tillat pop-ups og prøv igjen.",
                          variant: "destructive",
                        });
                        return;
                      }

                      const dateStr = new Date().toLocaleDateString('nb-NO');
                      const htmlContent = element.innerHTML;

                      printWindow.document.write(`<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <title>Møtereferat – ${dateStr}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      margin: 0;
      padding: 20mm 20mm 20mm 20mm;
    }
    h1 { font-size: 20pt; font-weight: 700; margin: 0 0 16px 0; color: #111; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 14pt; font-weight: 700; margin: 24px 0 8px 0; color: #111; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3 { font-size: 12pt; font-weight: 600; margin: 16px 0 6px 0; color: #222; }
    h4 { font-size: 11pt; font-weight: 600; margin: 12px 0 4px 0; color: #333; }
    p { margin: 6px 0; }
    ul, ol { margin: 6px 0; padding-left: 20px; }
    li { margin: 3px 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; page-break-inside: avoid; }
    th { background: #f0f0f0; font-weight: 600; text-align: left; padding: 6px 10px; border: 1px solid #ccc; }
    td { padding: 5px 10px; border: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 9pt; }
    blockquote { border-left: 3px solid #ccc; margin: 8px 0; padding: 4px 12px; color: #555; }
    hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
    a { color: #1a56db; text-decoration: none; }
    @media print {
      body { padding: 0; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>${htmlContent}</body>
</html>`);
                      printWindow.document.close();
                      printWindow.focus();
                      setTimeout(() => {
                        printWindow.print();
                      }, 400);
                    }}
                    data-testid="button-download-pdf"
                    className="gap-2"
                  >
                    <FileDown className="h-4 w-4" />
                    Last ned PDF
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto px-6 py-4">
            {isGeneratingSummary ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <p className="text-lg text-muted-foreground">Genererer referat...</p>
                <p className="text-sm text-muted-foreground mt-2">Dette kan ta opptil ett minutt</p>
              </div>
            ) : isEditingSummary ? (
              <SummaryWysiwygEditor
                ref={summaryEditorRef}
                initialMarkdown={meetingSummary || ""}
              />
            ) : (
              <>
                <style>{`
                  .summary-rendered h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 1.5rem; padding-bottom: 0.75rem; border-bottom: 2px solid hsl(var(--primary) / 0.2); }
                  .summary-rendered h2 { font-size: 1.25rem; font-weight: 600; margin: 2rem 0 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid hsl(var(--border)); }
                  .summary-rendered h3 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
                  .summary-rendered p { font-size: 1rem; line-height: 1.65; margin-bottom: 1rem; }
                  .summary-rendered ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1rem; }
                  .summary-rendered ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 1rem; }
                  .summary-rendered li { margin-bottom: 0.4rem; line-height: 1.6; }
                  .summary-rendered strong { font-weight: 700; }
                  .summary-rendered em { font-style: italic; }
                  .summary-rendered hr { border: none; border-top: 2px solid hsl(var(--border)); margin: 2rem 0; }
                  .summary-rendered blockquote { border-left: 4px solid hsl(var(--primary) / 0.4); padding: 0.5rem 1rem; margin: 1rem 0; background: hsl(var(--muted) / 0.2); border-radius: 0 0.25rem 0.25rem 0; font-style: italic; }
                  .summary-rendered code { background: hsl(var(--muted)); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-size: 0.85em; font-family: monospace; }
                  .summary-rendered table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; border: 1px solid hsl(var(--border)); border-radius: 0.375rem; overflow: hidden; }
                  .summary-rendered th { background: hsl(var(--muted) / 0.5); font-weight: 600; text-align: left; padding: 0.75rem 1rem; border: 1px solid hsl(var(--border)); }
                  .summary-rendered td { padding: 0.65rem 1rem; border: 1px solid hsl(var(--border)); vertical-align: top; }
                  .summary-rendered tr:nth-child(even) td { background: hsl(var(--muted) / 0.15); }
                `}</style>
                <div
                  id="summary-content"
                  className="summary-rendered max-w-none mx-auto"
                  dangerouslySetInnerHTML={{ __html: (() => {
                    // Split at <table>...</table> boundaries so raw HTML tables
                    // are preserved as-is, while everything else is parsed as markdown.
                    const parts = meetingSummary.split(/(<table[\s\S]*?<\/table>)/gi);
                    return parts.map(part =>
                      /^<table/i.test(part.trim())
                        ? part  // raw HTML table — pass through unchanged
                        : (marked.parse(part, { gfm: true }) as string)
                    ).join('');
                  })() }}
                />
              </>
            )}
          </div>
          
          {/* Summary feedback section — only in view mode */}
          {meetingSummary && !isGeneratingSummary && !isEditingSummary && (
            <div className="px-6 py-3 border-t bg-muted/30 shrink-0">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Gi tilbakemelding på referatet – AI-en lærer av det
              </p>
              <div className="flex gap-2">
                <Textarea
                  placeholder="Hva er bra? Hva mangler? Hva bør endres neste gang?..."
                  value={summaryFeedbackText}
                  onChange={e => setSummaryFeedbackText(e.target.value)}
                  className="text-xs min-h-[56px] resize-none flex-1"
                  data-testid="textarea-summary-feedback"
                />
                <Button
                  size="sm"
                  onClick={submitSummaryFeedback}
                  disabled={!summaryFeedbackText.trim() || isSubmittingSummaryFeedback}
                  className="self-end shrink-0"
                  data-testid="button-submit-summary-feedback"
                >
                  {isSubmittingSummaryFeedback ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Send"}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t shrink-0">
            {isEditingSummary ? (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditingSummary(false);
                    setSummaryEditText("");
                  }}
                  data-testid="button-cancel-summary-edit"
                >
                  Avbryt
                </Button>
                <Button
                  onClick={saveSummaryEdits}
                  disabled={isSavingSummaryEdits}
                  data-testid="button-save-summary-edits"
                  className="gap-2"
                >
                  {isSavingSummaryEdits ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Lagre referat
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full gap-4">
                {isAnalyzingDiff ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                    <span>AI analyserer redigeringen og oppdaterer hukommelsen…</span>
                  </div>
                ) : lastLearnedProfile ? (
                  <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                    <Brain className="h-3.5 w-3.5" />
                    <span>AI lærte av siste redigering — preferanser oppdatert</span>
                  </div>
                ) : <div />}
                <Button variant="outline" onClick={() => setShowSummaryDialog(false)}>
                  Lukk
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSessionsDialog} onOpenChange={(open) => {
        setShowSessionsDialog(open);
        if (open) {
          authFetch("/api/series").then(r => r.ok ? r.json() : null).then(d => {
            if (d?.series) setSeriesList(d.series);
          }).catch(() => {});
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tidligere møter</DialogTitle>
            <DialogDescription>
              Velg et tidligere møte for å laste det inn, eller administrer lagrede sesjoner
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="h-96">
              {!sessionsData?.sessions || sessionsData.sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <History className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">Ingen lagrede møter</p>
                  <p className="text-sm text-muted-foreground">Lagre et møte for å se det her</p>
                </div>
              ) : (() => {
                const sortedSessions = [...sessionsData.sessions].sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
                // Group by series
                const seriesGroups: Record<string, { label: string; sessions: any[] }> = {};
                const standaloneKey = "__standalone__";
                for (const session of sortedSessions) {
                  if (session.seriesId) {
                    const key = String(session.seriesId);
                    if (!seriesGroups[key]) {
                      const found = seriesList.find(s => s.id === session.seriesId);
                      const label = found?.name ?? session.seriesName ?? `Serie #${session.seriesId}`;
                      seriesGroups[key] = { label, sessions: [] };
                    }
                    seriesGroups[key].sessions.push(session);
                  } else {
                    if (!seriesGroups[standaloneKey]) seriesGroups[standaloneKey] = { label: "Enkeltmøter", sessions: [] };
                    seriesGroups[standaloneKey].sessions.push(session);
                  }
                }
                const hasSeries = Object.keys(seriesGroups).some(k => k !== standaloneKey);
                const renderSessionRow = (session: any) => (
                  <div
                    key={session.id}
                    className={`p-4 rounded-md border flex items-center justify-between gap-3 hover-elevate ${sessionId === session.id ? 'border-primary bg-primary/5' : ''}`}
                    data-testid={`session-row-${session.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{session.title || `Møte #${session.id}`}</p>
                        {sessionId === session.id && (
                          <Badge variant="default" className="text-xs">Aktiv</Badge>
                        )}
                        {session.seriesIndex && (
                          <Badge variant="outline" className="text-xs">Møte {session.seriesIndex}</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>{new Date(session.startedAt).toLocaleDateString('nb-NO')}</span>
                        <span>{new Date(session.startedAt).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
                        {session.elapsedSeconds > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {Math.floor(session.elapsedSeconds / 60)} min
                          </Badge>
                        )}
                        {session.transcript?.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {session.transcript.length} segmenter
                          </Badge>
                        )}
                        {session.questions?.filter((q: any) => q.status === 'saved')?.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {session.questions.filter((q: any) => q.status === 'saved').length} sprsml
                          </Badge>
                        )}
                        {session.actionItems?.filter((a: any) => a.status === 'approved')?.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {session.actionItems.filter((a: any) => a.status === 'approved').length} aksjoner
                          </Badge>
                        )}
                        {session.summary && (
                          <Badge
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-blue-100 hover:text-blue-700 transition-colors"
                            title="Klikk for å åpne referatet"
                            onClick={() => {
                              preSummaryPreviewRef.current = meetingSummaryRef.current;
                              setMeetingSummary(session.summary);
                              meetingSummaryRef.current = session.summary;
                              setSummaryPreviewSessionId(session.id);
                              setIsEditingSummary(false);
                              setShowSessionsDialog(false);
                              setShowSummaryDialog(true);
                            }}
                          >
                            <FileText className="h-3 w-3 mr-1" />Referat
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setRenameSessionId(session.id);
                          setRenameTitle(session.title || "");
                          setShowRenameDialog(true);
                        }}
                        data-testid={`button-rename-session-${session.id}`}
                        title="Gi nytt navn"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {session.summary && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 gap-1.5 px-2"
                            title="Vis møtereferat"
                            data-testid={`button-view-summary-${session.id}`}
                            onClick={() => {
                              preSummaryPreviewRef.current = meetingSummaryRef.current;
                              setMeetingSummary(session.summary);
                              meetingSummaryRef.current = session.summary;
                              setSummaryPreviewSessionId(session.id);
                              setIsEditingSummary(false);
                              setShowSessionsDialog(false);
                              setShowSummaryDialog(true);
                            }}
                          >
                            <FileText className="h-4 w-4" />
                            <span className="text-xs hidden sm:inline">Referat</span>
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            title="Last ned referat som PDF"
                            data-testid={`button-pdf-summary-${session.id}`}
                            onClick={() => printSummaryAsPdf(session.summary, session.title)}
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => loadSession(session.id)}
                        data-testid={`button-load-session-${session.id}`}
                        title="Last inn møte"
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => deleteSession(session.id)}
                        data-testid={`button-delete-session-${session.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
                if (!hasSeries) {
                  return <div className="space-y-2">{sortedSessions.map(renderSessionRow)}</div>;
                }
                return (
                  <div className="space-y-4">
                    {Object.entries(seriesGroups).map(([key, group]) => (
                      <div key={key}>
                        {key !== standaloneKey ? (
                          <div className="flex items-center gap-2 mb-2">
                            <ListOrdered className="h-4 w-4 text-blue-600 flex-shrink-0" />
                            {renamingSeriesId === Number(key) ? (
                              <>
                                <Input
                                  className="h-7 text-sm py-0 w-48"
                                  value={renameSeriesValue}
                                  onChange={e => setRenameSeriesValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const newName = renameSeriesValue.trim();
                                      if (!newName) return;
                                      authFetch(`/api/series/${key}`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ name: newName }),
                                      }).then(r => r.ok ? r.json() : null).then(d => {
                                        if (d?.series) {
                                          setSeriesList(prev => prev.map(s => s.id === Number(key) ? { ...s, name: d.series.name } : s));
                                          if (seriesId === Number(key)) setSeriesName(d.series.name);
                                        }
                                        setRenamingSeriesId(null);
                                      });
                                    }
                                    if (e.key === "Escape") setRenamingSeriesId(null);
                                  }}
                                  autoFocus
                                  data-testid={`input-rename-series-${key}`}
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-green-600 hover:text-green-700"
                                  onClick={() => {
                                    const newName = renameSeriesValue.trim();
                                    if (!newName) return;
                                    authFetch(`/api/series/${key}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ name: newName }),
                                    }).then(r => r.ok ? r.json() : null).then(d => {
                                      if (d?.series) {
                                        setSeriesList(prev => prev.map(s => s.id === Number(key) ? { ...s, name: d.series.name } : s));
                                        if (seriesId === Number(key)) setSeriesName(d.series.name);
                                      }
                                      setRenamingSeriesId(null);
                                    });
                                  }}
                                  data-testid={`button-save-rename-series-${key}`}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground"
                                  onClick={() => setRenamingSeriesId(null)}
                                  data-testid={`button-cancel-rename-series-${key}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">{group.label}</span>
                                <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">{group.sessions.length} møter</Badge>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:text-blue-600 ml-1"
                                  title="Endre serienavn"
                                  onClick={() => {
                                    setRenamingSeriesId(Number(key));
                                    setRenameSeriesValue(group.label);
                                  }}
                                  data-testid={`button-rename-series-${key}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Enkeltmøter</span>
                          </div>
                        )}
                        <div className="space-y-2 pl-2 border-l-2 border-blue-100 dark:border-blue-900">
                          {group.sessions.map(renderSessionRow)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSessionsDialog(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lagre møte</DialogTitle>
            <DialogDescription>
              Gi møtet et navn og velg eventuelt en møteserie
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Møtenavn</label>
              <Input
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="Skriv inn møtenavn..."
                autoFocus
                data-testid="input-session-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Møteserie (valgfritt)</label>
              <Select
                value={saveDialogSeriesId === "new" ? "new" : saveDialogSeriesId !== null ? String(saveDialogSeriesId) : "none"}
                onValueChange={(val) => {
                  if (val === "none") setSaveDialogSeriesId(null);
                  else if (val === "new") setSaveDialogSeriesId("new");
                  else setSaveDialogSeriesId(parseInt(val));
                }}
              >
                <SelectTrigger data-testid="select-series">
                  <SelectValue placeholder="Ingen serie (enkelt møte)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Enkelt møte (ingen serie)</SelectItem>
                  {seriesList.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} ({s.sessionCount} møter)
                    </SelectItem>
                  ))}
                  <SelectItem value="new">+ Opprett ny serie...</SelectItem>
                </SelectContent>
              </Select>
              {saveDialogSeriesId === "new" && (
                <Input
                  className="mt-2"
                  value={saveDialogNewSeriesName}
                  onChange={e => setSaveDialogNewSeriesName(e.target.value)}
                  placeholder="Navn på ny møteserie..."
                  data-testid="input-new-series-name"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Avbryt
            </Button>
            <Button 
              onClick={() => saveSession(sessionTitle, saveDialogSeriesId, saveDialogNewSeriesName)}
              disabled={!sessionTitle.trim() || isSavingSession || (saveDialogSeriesId === "new" && !saveDialogNewSeriesName.trim())}
              data-testid="button-confirm-save"
            >
              {isSavingSession ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Lagre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Endre navn</DialogTitle>
            <DialogDescription>
              Gi møtet et nytt navn
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              placeholder="Skriv inn nytt navn..."
              autoFocus
              data-testid="input-rename-title"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowRenameDialog(false);
              setRenameSessionId(null);
              setRenameTitle("");
            }}>
              Avbryt
            </Button>
            <Button 
              onClick={renameSession}
              disabled={!renameTitle.trim()}
              data-testid="button-confirm-rename"
            >
              <Pencil className="h-4 w-4 mr-2" />
              Lagre navn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Meeting Documents Dialog */}
      <Dialog open={showMeetingDocsDialog} onOpenChange={setShowMeetingDocsDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Møtedokumenter
            </DialogTitle>
            <DialogDescription>
              Last opp dokumenter AI-en skal lese og lære. Hvis noe i møtet strider mot innholdet, varsles du med røde spørsmål.
            </DialogDescription>
          </DialogHeader>

          {!sessionId && !seriesId ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Lagre møtet (eller koble det til en serie) for å laste opp møtedokumenter.</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Scope selector */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium whitespace-nowrap">Gjelder for:</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={meetingDocScope === "session" ? "default" : "outline"}
                    onClick={() => setMeetingDocScope("session")}
                    disabled={!sessionId}
                    data-testid="button-scope-session"
                  >
                    Dette møtet
                  </Button>
                  <Button
                    size="sm"
                    variant={meetingDocScope === "series" ? "default" : "outline"}
                    onClick={() => setMeetingDocScope("series")}
                    disabled={!seriesId}
                    title={!seriesId ? "Møtet er ikke del av en serie" : ""}
                    data-testid="button-scope-series"
                  >
                    Hele serien
                    {!seriesId && <span className="ml-1 opacity-50 text-xs">(ingen serie)</span>}
                  </Button>
                </div>
              </div>

              {/* Upload tabs */}
              <div className="flex gap-1 border rounded-md p-1 w-fit">
                <Button size="sm" variant={meetingDocUploadTab === "file" ? "default" : "ghost"} onClick={() => setMeetingDocUploadTab("file")}>
                  Fil (PDF/TXT/DOCX)
                </Button>
                <Button size="sm" variant={meetingDocUploadTab === "text" ? "default" : "ghost"} onClick={() => setMeetingDocUploadTab("text")}>
                  Lim inn tekst
                </Button>
              </div>

              {meetingDocUploadTab === "file" ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={meetingDocFileRef}
                    type="file"
                    accept=".pdf,.txt,.docx"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await uploadMeetingDoc(file);
                      e.target.value = "";
                    }}
                    data-testid="input-meeting-doc-file"
                  />
                  <Button
                    onClick={() => meetingDocFileRef.current?.click()}
                    disabled={isUploadingMeetingDoc}
                    data-testid="button-upload-meeting-doc"
                    className="gap-2"
                  >
                    {isUploadingMeetingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isUploadingMeetingDoc ? "Indekserer..." : "Velg fil"}
                  </Button>
                  <span className="text-xs text-muted-foreground">PDF, TXT eller DOCX</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Dokumentnavn (valgfritt)"
                    value={meetingDocPastedName}
                    onChange={e => setMeetingDocPastedName(e.target.value)}
                    data-testid="input-meeting-doc-name"
                  />
                  <textarea
                    className="w-full min-h-[100px] text-sm border rounded-md p-2 resize-none bg-background"
                    placeholder="Lim inn tekst her..."
                    value={meetingDocPastedText}
                    onChange={e => setMeetingDocPastedText(e.target.value)}
                    data-testid="textarea-meeting-doc-text"
                  />
                  <Button
                    onClick={() => uploadMeetingDoc()}
                    disabled={isUploadingMeetingDoc || !meetingDocPastedText.trim()}
                    className="gap-2 w-full"
                    data-testid="button-upload-pasted-doc"
                  >
                    {isUploadingMeetingDoc ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {isUploadingMeetingDoc ? "Indekserer..." : "Last opp og indekser"}
                  </Button>
                </div>
              )}

              {/* Uploaded docs list */}
              {meetingKnowledgeDocs.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Opplastede dokumenter</p>
                  {meetingKnowledgeDocs.map(doc => (
                    <div key={doc.id} className="flex items-start justify-between gap-2 p-2 rounded-md border bg-blue-50/50 dark:bg-blue-950/20">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{doc.originalName}</p>
                          <div className="flex gap-2 mt-0.5">
                            <Badge variant="outline" className="text-xs">
                              {doc.sessionId ? "Dette møtet" : "Serie"}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(doc.createdAt).toLocaleDateString("nb-NO")}
                            </span>
                          </div>
                          {doc.rawContentPreview && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{doc.rawContentPreview}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive flex-shrink-0"
                        onClick={() => deleteMeetingDoc(doc.id)}
                        data-testid={`button-delete-meeting-doc-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMeetingDocsDialog(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rules Management Dialog */}
      <Dialog open={showRulesDialog} onOpenChange={setShowRulesDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Regeldokumenter
            </DialogTitle>
            <DialogDescription>
              Last opp regeldokumenter (1-5 stk) for automatisk regelsjekking under møtet. 
              AI-en vil varsle dersom diskusjonen strider mot opplastede regler.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Upload section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Opplastede dokumenter ({uploadedDocuments.length}/5)
                </label>
                {uploadedDocuments.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllRules}
                    className="text-destructive"
                    data-testid="button-clear-all-rules"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Slett alle
                  </Button>
                )}
              </div>
              
              <input
                ref={ruleFileInputRef}
                type="file"
                accept=".pdf,.txt,.docx"
                onChange={handleRuleDocumentUpload}
                className="hidden"
                data-testid="input-rule-file"
              />
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => ruleFileInputRef.current?.click()}
                  disabled={isUploadingRule || isProcessingPastedRule || uploadedDocuments.length >= 5}
                  data-testid="button-upload-rule-doc"
                >
                  {isUploadingRule ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyserer...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Last opp fil
                    </>
                  )}
                </Button>
              </div>
              
              {/* Text paste option */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Eller lim inn tekst direkte:
                </label>
                <Textarea
                  placeholder="Lim inn regeltekst her (TEK17, kontrakter, forskrifter...)"
                  value={pastedRuleText}
                  onChange={(e) => setPastedRuleText(e.target.value)}
                  className="min-h-[100px] text-sm"
                  data-testid="textarea-paste-rules"
                />
                <Button
                  variant="default"
                  className="w-full"
                  onClick={handlePastedRuleText}
                  disabled={isProcessingPastedRule || isUploadingRule || !pastedRuleText.trim() || uploadedDocuments.length >= 5}
                  data-testid="button-analyze-pasted-rules"
                >
                  {isProcessingPastedRule ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyserer tekst...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Analyser innlimt tekst
                    </>
                  )}
                </Button>
              </div>
            </div>
            
            {/* Document list */}
            {uploadedDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileWarning className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Ingen regeldokumenter lastet opp</p>
                <p className="text-xs mt-1">
                  Last opp TEK17, kontrakter, reguleringsbestemmelser eller andre regelverk
                </p>
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {uploadedDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 rounded-md border bg-muted/30"
                      data-testid={`rule-document-${doc.id}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate text-sm">{doc.originalName}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {doc.status === "processing" && (
                              <Badge variant="secondary" className="text-xs">
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                Analyserer...
                              </Badge>
                            )}
                            {doc.status === "ready" && (
                              <Badge variant="default" className="text-xs">
                                {doc.rulesExtracted} regler
                              </Badge>
                            )}
                            {doc.status === "error" && (
                              <Badge variant="destructive" className="text-xs">
                                Feil
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {(doc.size / 1024).toFixed(1)} KB
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRuleDocument(doc.id)}
                        data-testid={`button-delete-rule-doc-${doc.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
            
            {/* Rule summary */}
            {ruleCount > 0 && (
              <div className="p-3 rounded-md bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary" />
                  <span className="font-medium">
                    {ruleCount} regler klare for sjekking
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  AI-en vil varsle dersom samtalen strider mot disse reglene under møtet
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRulesDialog(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Word Corrections Dialog */}
      <Dialog open={showWordCorrectionsDialog} onOpenChange={setShowWordCorrectionsDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Replace className="h-5 w-5" />
              Ordkorrigeringer
            </DialogTitle>
            <DialogDescription>
              Definer ord som ofte transkriberes feil. De vil automatisk erstattes i fremtidige og eksisterende transkripsjoner.
              Du kan også markere tekst direkte i transkriptet for rask korrigering.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Add new correction */}
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <p className="text-sm font-medium">Legg til ny korrigering</p>
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="Feil ord/uttrykk"
                  value={newOriginal}
                  onChange={e => setNewOriginal(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddWordCorrection()}
                  data-testid="input-correction-original"
                  className="flex-1"
                />
                <span className="text-muted-foreground text-sm">→</span>
                <Input
                  placeholder="Riktig ord/uttrykk"
                  value={newCorrected}
                  onChange={e => setNewCorrected(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddWordCorrection()}
                  data-testid="input-correction-corrected"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleAddWordCorrection}
                  disabled={!newOriginal.trim() || !newCorrected.trim() || isSavingCorrection}
                  data-testid="button-save-correction"
                >
                  {isSavingCorrection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Existing corrections */}
            {wordCorrectionsList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4 italic">
                Ingen ordkorrigeringer definert ennå
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Aktive korrigeringer ({wordCorrectionsList.length})</p>
                {wordCorrectionsList.map(c => (
                  <div key={c.id} className="flex items-center gap-2 p-2 border rounded-lg bg-background">
                    <span className="text-sm flex-1 font-mono text-red-600 dark:text-red-400">{c.original}</span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="text-sm flex-1 font-mono text-green-600 dark:text-green-400">{c.corrected}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteWordCorrection(c.id)}
                      data-testid={`button-delete-correction-${c.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWordCorrectionsDialog(false)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick correction popup (shown on text selection in transcript) */}
      {showQuickCorrectionPopup && quickCorrectionPos && (
        <div
          className="fixed z-50 bg-popover border rounded-lg shadow-lg p-3 space-y-2 min-w-[240px]"
          style={{ top: quickCorrectionPos.y - 120, left: Math.max(8, quickCorrectionPos.x - 120) }}
        >
          <p className="text-xs font-medium text-muted-foreground">Korriger valgt tekst</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500 font-mono truncate max-w-[80px]">{selectedTranscriptText}</span>
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              className="h-7 text-xs flex-1"
              value={quickCorrectedText}
              onChange={e => setQuickCorrectedText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSaveQuickCorrection(); if (e.key === "Escape") setShowQuickCorrectionPopup(false); }}
              autoFocus
              data-testid="input-quick-correction"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowQuickCorrectionPopup(false)}>Avbryt</Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleSaveQuickCorrection} disabled={!quickCorrectedText.trim() || isSavingCorrection}>
              {isSavingCorrection ? <Loader2 className="h-3 w-3 animate-spin" /> : "Lagre"}
            </Button>
          </div>
        </div>
      )}

      {/* Audio File Upload Dialog */}
      <Dialog open={showAudioUploadDialog} onOpenChange={setShowAudioUploadDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              Last opp lydfil for transkripsjon
            </DialogTitle>
            <DialogDescription>
              Last opp en lydfil fra et tidligere møte for å transkribere og generere referat.
              Støtter MP3, M4A, WAV, WEBM, OGG og FLAC (maks 200 MB). Store filer deles automatisk opp.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* Upload section */}
            <input
              ref={audioFileInputRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.webm,.ogg,.flac"
              onChange={handleAudioFileUpload}
              className="hidden"
              data-testid="input-audio-file"
            />
            
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => audioFileInputRef.current?.click()}
                disabled={isTranscribingFile}
                className="flex-1 gap-2"
                data-testid="button-select-audio-file"
              >
                {isTranscribingFile ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transkriberer...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Velg lydfil...
                  </>
                )}
              </Button>
            </div>
            
            {/* Transcription result */}
            {uploadedAudioResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span className="font-medium">{uploadedAudioResult.filename}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    {uploadedAudioResult.duration}
                    <span className="mx-1">|</span>
                    {uploadedAudioResult.segments.length} segmenter
                  </div>
                </div>
                
                {/* Transcript preview */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Transkript (forhåndsvisning)</label>
                  <ScrollArea className="h-48 border rounded-md p-3 bg-background">
                    <div className="space-y-2">
                      {uploadedAudioResult.segments.map((seg, index) => (
                        <div key={seg.id || index} className="text-sm">
                          <span className="text-muted-foreground">[{seg.timestamp}]</span>{" "}
                          <span className="font-medium">{seg.speaker}:</span>{" "}
                          <span>{seg.text}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
                
                {/* Summary generation */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={generateFileSummary}
                      disabled={isGeneratingFileSummary}
                      className="gap-2"
                      data-testid="button-generate-file-summary"
                    >
                      {isGeneratingFileSummary ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Genererer referat...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Generer referat
                        </>
                      )}
                    </Button>
                    
                    <Button
                      variant="outline"
                      onClick={loadUploadedToMeeting}
                      className="gap-2"
                      data-testid="button-load-to-meeting"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Last inn i møte
                    </Button>
                  </div>
                </div>
                
                {/* Summary result */}
                {uploadedFileSummary && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Møtereferat</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(uploadedFileSummary);
                          toast({
                            title: "Kopiert",
                            description: "Referatet er kopiert til utklippstavlen",
                          });
                        }}
                        data-testid="button-copy-file-summary"
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Kopier
                      </Button>
                    </div>
                    <ScrollArea className="h-64 border rounded-md p-4 bg-background">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {uploadedFileSummary}
                        </ReactMarkdown>
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAudioUploadDialog(false)}>
              Lukk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Learning dialog */}
      <Dialog open={showLearningDialog} onOpenChange={setShowLearningDialog}>
        <DialogContent className="max-w-2xl w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Hva har appen lært?
            </DialogTitle>
            <DialogDescription>
              Basert på dine godkjenninger, avvisninger og tilbakemeldinger har AI-en bygget opp en forståelse av dine preferanser.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {isLoadingLearning ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Tabs defaultValue="actions">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="actions" className="flex-1">Aksjoner og beslutninger</TabsTrigger>
                  <TabsTrigger value="summary" className="flex-1">Møtereferater</TabsTrigger>
                </TabsList>
                <TabsContent value="actions">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">{learningProfiles?.aiSignalCount || 0} signaler registrert</span>
                      {learningProfiles?.aiLastUpdated && (
                        <span>· Sist oppdatert {new Date(learningProfiles.aiLastUpdated).toLocaleDateString("nb-NO")}</span>
                      )}
                    </div>
                    {learningProfiles?.aiProfile ? (
                      <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{learningProfiles.aiProfile}</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg bg-muted border text-center">
                        <Lightbulb className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          {(learningProfiles?.aiSignalCount || 0) < 5
                            ? `Godkjenn eller avvis ${5 - (learningProfiles?.aiSignalCount || 0)} aksjoner/beslutninger til for å aktivere læring.`
                            : "AI-profilen oppdateres automatisk etter hvert som du gir tilbakemeldinger."}
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="summary">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">{learningProfiles?.summaryFeedbackCount || 0} redigeringer/tilbakemeldinger registrert</span>
                        {learningProfiles?.summaryLastUpdated && (
                          <span>· Sist oppdatert {new Date(learningProfiles.summaryLastUpdated).toLocaleDateString("nb-NO")}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded px-3 py-2">
                      <strong>Slik fungerer hukommelsen:</strong> Hver gang du redigerer et referat, sammenligner AI-en automatisk det den genererte med det du faktisk ønsket. Konkrete forskjeller lagres og injiseres i neste referat-prompt.
                    </div>
                    {(learningProfiles?.summaryProfile || lastLearnedProfile) ? (
                      <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Brain className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Lært preferanse-profil (brukes ved neste referat)</span>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{lastLearnedProfile || learningProfiles?.summaryProfile}</p>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg bg-muted border text-center">
                        <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Ingen preferanser lært ennå. Rediger ett referat og lagre, så lærer AI-en umiddelbart.
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLearningDialog(false)}>Lukk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject reason dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rejectTarget?.type === "action" ? "Avvis aksjonspunkt" : "Avvis beslutning"}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground line-clamp-3 mt-1">
              {rejectTarget?.text}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="text-sm font-medium mb-1 block">Årsak (valgfri)</label>
            <textarea
              data-testid="input-reject-reason"
              className="w-full border rounded-md p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="Hvorfor avvises dette? Hjelper AI-en å lære..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Avbryt</Button>
            <Button variant="destructive" data-testid="button-confirm-reject" onClick={confirmReject}>Avvis</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
