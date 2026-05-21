import { z } from "zod";
import { pgTable, serial, text, timestamp, varchar, integer, jsonb, boolean, uuid, index, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const transcriptSegmentSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  speaker: z.string(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const questionStatusSchema = z.enum(["new", "saved", "deleted"]);
export type QuestionStatus = z.infer<typeof questionStatusSchema>;

export const expertRoleSchema = z.enum(["bygg", "hr", "jus", "uformell", "pappa", "sureaud"]);
export type ExpertRole = z.infer<typeof expertRoleSchema>;

export const expertRoleLabels: Record<ExpertRole, string> = {
  bygg: "Bygg & Prosjekt",
  hr: "HR & Arbeidsmiljø",
  jus: "Jus & Kontrakt",
  uformell: "Djevelens advokat",
  pappa: "Pappa-vitser",
  sureaud: "Sure-Aud",
};

export const questionTypeSchema = z.enum(["normal", "cross_meeting"]).default("normal");
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  minuteIndex: z.number(),
  status: questionStatusSchema,
  createdAt: z.string(),
  annotation: z.string().optional(),
  expertRole: expertRoleSchema.optional(),
  type: questionTypeSchema.optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const actionItemStatusSchema = z.enum(["proposed", "approved", "rejected"]);
export type ActionItemStatus = z.infer<typeof actionItemStatusSchema>;

export const itemSourceSchema = z.enum(["ai", "manual"]).default("ai");
export type ItemSource = z.infer<typeof itemSourceSchema>;

export const actionItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  suggestedOwner: z.string().nullable().optional(),
  suggestedDeadline: z.string().nullable().optional(),
  status: actionItemStatusSchema,
  source: itemSourceSchema.optional(),
  owner: z.string().optional(),
  deadline: z.string().optional(),
  minuteIndex: z.number(),
  createdAt: z.string(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

export const decisionStatusSchema = z.enum(["proposed", "confirmed", "rejected"]);
export type DecisionStatus = z.infer<typeof decisionStatusSchema>;

export const proposedDecisionSchema = z.object({
  id: z.string(),
  text: z.string(),
  context: z.string().optional(),
  owner: z.string().optional(),
  status: decisionStatusSchema,
  source: itemSourceSchema.optional(),
  confirmedAt: z.string().optional(),
  minuteIndex: z.number(),
  createdAt: z.string(),
});
export type ProposedDecision = z.infer<typeof proposedDecisionSchema>;

// ============= Meeting Series =============

export const meetingSeries = pgTable("meeting_series", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_meeting_series_user").on(t.userId),
}));

export const insertMeetingSeriesSchema = createInsertSchema(meetingSeries).omit({ id: true, createdAt: true });
export type InsertMeetingSeries = z.infer<typeof insertMeetingSeriesSchema>;
export type MeetingSeriesRow = typeof meetingSeries.$inferSelect;

export const voiceProfiles = pgTable("voice_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  audioPath: text("audio_path").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVoiceProfileSchema = createInsertSchema(voiceProfiles).omit({ id: true, createdAt: true });
export type InsertVoiceProfile = z.infer<typeof insertVoiceProfileSchema>;
export type VoiceProfile = typeof voiceProfiles.$inferSelect;

export const meetingSessions = pgTable("meeting_sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  title: varchar("title", { length: 255 }),
  seriesId: integer("series_id"),
  seriesIndex: integer("series_index"),
  seriesName: varchar("series_name", { length: 255 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  elapsedSeconds: integer("elapsed_seconds").default(0),
  expertRole: varchar("expert_role", { length: 50 }),
  questionInterval: integer("question_interval").default(1),
  transcript: jsonb("transcript").$type<TranscriptSegment[]>().default([]),
  questions: jsonb("questions").$type<Question[]>().default([]),
  actionItems: jsonb("action_items").$type<ActionItem[]>().default([]),
  decisions: jsonb("decisions").$type<ProposedDecision[]>().default([]),
  speakerMappings: jsonb("speaker_mappings").$type<Record<string, string>>().default({}),
  summary: text("summary"),
  // Brukerens egne stikkord/notater under møtet (Granola-style "primary canvas")
  userNotes: text("user_notes"),
}, (t) => ({
  userIdx: index("idx_meeting_sessions_user").on(t.userId),
  seriesIdx: index("idx_meeting_sessions_series").on(t.seriesId),
}));

export const insertMeetingSessionSchema = createInsertSchema(meetingSessions).omit({ id: true, startedAt: true });
export type InsertMeetingSession = z.infer<typeof insertMeetingSessionSchema>;
export type MeetingSession = typeof meetingSessions.$inferSelect;

export const transcribeRequestSchema = z.object({
  audio: z.string(),
  mimeType: z.string().optional(),
  model: z.enum(["medium", "large", "openai"]).optional(),
  // Valgfritt domene-hint (max ~224 tokens for Whisper). Brukes til å bias
  // transkripsjonen mot rett vokabular — f.eks. "taktplanlegging,
  // siste-planner, lean construction".
  prompt: z.string().max(2000).optional(),
  // Lyd-språk. "auto" lar Whisper detektere. Default for klienter som ikke
  // sender feltet er "no" (eksisterende oppførsel).
  language: z.enum(["no", "en", "auto"]).optional(),
  // Hvis satt, kjør AI-renskriving av segmentene etter Whisper. AI fikser
  // åpenbare feiltranskripsjoner basert på topic og oversetter til
  // targetLanguage hvis input er annet språk.
  cleanup: z.object({
    topic: z.string().optional(),
    targetLanguage: z.enum(["no", "en"]).default("no"),
  }).optional(),
});
export type TranscribeRequest = z.infer<typeof transcribeRequestSchema>;

export const transcribeResponseSchema = z.object({
  segments: z.array(transcriptSegmentSchema),
});
export type TranscribeResponse = z.infer<typeof transcribeResponseSchema>;

export const seriesSummarySchema = z.object({
  title: z.string(),
  date: z.string(),
  summary: z.string(),
  seriesIndex: z.number().optional(),
});
export type SeriesSummary = z.infer<typeof seriesSummarySchema>;

export const analyzeRequestSchema = z.object({
  transcript: z.string(),
  fullTranscript: z.string().optional(),
  expertRole: expertRoleSchema.optional().default("bygg"),
  existingActions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    suggestedOwner: z.string().nullable().optional(),
    suggestedDeadline: z.string().nullable().optional(),
    status: z.string(),
  })).optional(),
  existingDecisions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    context: z.string().optional(),
    status: z.string(),
  })).optional(),
  seriesSummaries: z.array(seriesSummarySchema).optional(),
  sessionId: z.number().optional(),
  seriesId: z.number().optional(),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const analyzeResponseSchema = z.object({
  questions: z.array(z.string()),
  crossMeetingQuestions: z.array(z.string()).optional(),
});
export type AnalyzeResponse = z.infer<typeof analyzeResponseSchema>;

export const summaryRequestSchema = z.object({
  transcript: z.string(),
  savedQuestions: z.array(z.string()),
  seriesSummaries: z.array(seriesSummarySchema).optional(),
  approvedActions: z.array(z.object({
    text: z.string(),
    owner: z.string().optional(),
    deadline: z.string().optional(),
    source: z.enum(["ai", "manual"]).optional(),
  })).optional(),
  pendingActions: z.array(z.object({
    text: z.string(),
    suggestedOwner: z.string().optional().nullable(),
    suggestedDeadline: z.string().optional().nullable(),
    source: z.enum(["ai", "manual"]).optional(),
  })).optional(),
  confirmedDecisions: z.array(z.object({
    text: z.string(),
    context: z.string().optional(),
    source: z.enum(["ai", "manual"]).optional(),
  })).optional(),
  metadata: z.object({
    meeting_title: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    duration_minutes: z.number().optional(),
    organizer: z.string().optional(),
    participants: z.array(z.string()).optional(),
    agenda: z.array(z.string()).optional(),
    project: z.string().optional(),
    client: z.string().optional(),
    location: z.string().optional(),
    meeting_leader: z.string().optional(),
    secretary: z.string().optional(),
    absent: z.string().optional(),
  }).optional(),
  // Brukerens egne stikkord/notater fra møtet — skal brukes som primary
  // struktur av AI når referat genereres.
  userNotes: z.string().optional(),
  visualContext: z.array(z.object({
    id: z.number(),
    description: z.string(),
    capturedAt: z.string(),
  })).optional(),
});
export type SummaryRequest = z.infer<typeof summaryRequestSchema>;

export const summaryResponseSchema = z.object({ summary: z.string() });
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;

export const meetingMetaSchema = z.object({
  title: z.string().optional(),
  project: z.string().optional(),
  client: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  location: z.string().optional(),
  meetingLeader: z.string().optional(),
  secretary: z.string().optional(),
  participants: z.string().optional(),
  absent: z.string().optional(),
});
export type MeetingMeta = z.infer<typeof meetingMetaSchema>;

export const meetingStateSchema = z.object({
  transcript: z.array(transcriptSegmentSchema),
  questions: z.array(questionSchema),
  actionItems: z.array(actionItemSchema).optional(),
  decisions: z.array(proposedDecisionSchema).optional(),
  startTime: z.string().nullable(),
  elapsedSeconds: z.number(),
  speakerMappings: z.record(z.string(), z.string()).optional(),
  expertRole: expertRoleSchema.optional(),
  questionInterval: z.number().optional(),
  sessionId: z.number().optional(),
  sessionTitle: z.string().optional(),
  meetingMeta: meetingMetaSchema.optional(),
  seriesId: z.number().optional(),
  seriesName: z.string().optional(),
  summary: z.string().optional(),
});
export type MeetingState = z.infer<typeof meetingStateSchema>;

// ============= Meeting Documents (knowledge docs scoped to session or series) =============

export const meetingDocuments = pgTable("meeting_documents", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionId: integer("session_id"),
  seriesId: integer("series_id"),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  fileType: varchar("file_type", { length: 50 }).notNull(),
  keyPoints: text("key_points").notNull(),
  rawContentPreview: text("raw_content_preview"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_meeting_documents_user").on(t.userId),
  sessionIdx: index("idx_meeting_documents_session").on(t.sessionId),
  seriesIdx: index("idx_meeting_documents_series").on(t.seriesId),
}));

export const insertMeetingDocumentSchema = createInsertSchema(meetingDocuments).omit({ id: true, createdAt: true });
export type InsertMeetingDocument = z.infer<typeof insertMeetingDocumentSchema>;
export type MeetingDocument = typeof meetingDocuments.$inferSelect;

// ============= Learning / Feedback Tables =============

export const feedbackLog = pgTable("feedback_log", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  text: text("text").notNull(),
  context: text("context"),
  accepted: boolean("accepted").notNull(),
  reason: text("reason"),
  expertRole: varchar("expert_role", { length: 50 }),
  source: varchar("source", { length: 10 }).default("ai"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_feedback_log_user").on(t.userId),
}));
export type FeedbackLogEntry = typeof feedbackLog.$inferSelect;

export const aiPreferences = pgTable("ai_preferences", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().unique(),
  profileText: text("profile_text").notNull().default(""),
  signalCount: integer("signal_count").notNull().default(0),
  // Opt-out av kollektiv læring (default false = bruker bidrar anonymt)
  communityOptOut: boolean("community_opt_out").notNull().default(false),
  // Hvor mange anonymiserte signaler brukeren har bidratt med
  communityContributions: integer("community_contributions").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiPreferences = typeof aiPreferences.$inferSelect;

export const summaryFeedback = pgTable("summary_feedback", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  commentText: text("comment_text").notNull(),
  summaryExcerpt: text("summary_excerpt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_summary_feedback_user").on(t.userId),
}));
export type SummaryFeedbackEntry = typeof summaryFeedback.$inferSelect;

export const summaryPreferences = pgTable("summary_preferences", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().unique(),
  profileText: text("profile_text").notNull().default(""),
  feedbackCount: integer("feedback_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type SummaryPreferences = typeof summaryPreferences.$inferSelect;

export const ruleDocuments = pgTable("rule_documents", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path"),
  status: varchar("status", { length: 50 }).notNull().default("processing"),
  rulesExtracted: integer("rules_extracted").default(0),
  errorMessage: text("error_message"),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_rule_documents_user").on(t.userId),
}));

export const insertRuleDocumentSchema = createInsertSchema(ruleDocuments).omit({ id: true, uploadedAt: true });
export type InsertRuleDocument = z.infer<typeof insertRuleDocumentSchema>;
export type RuleDocument = typeof ruleDocuments.$inferSelect;

export const extractedRulesTable = pgTable("extracted_rules", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  documentId: integer("document_id").notNull(),
  externalRuleId: varchar("external_rule_id", { length: 100 }).notNull(),
  documentName: varchar("document_name", { length: 255 }).notNull(),
  section: text("section").notNull(),
  ruleTitle: text("rule_title").notNull(),
  ruleText: text("rule_text").notNull(),
  summary: text("summary").notNull(),
  tags: text("tags").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_extracted_rules_user").on(t.userId),
  documentIdx: index("idx_extracted_rules_document").on(t.documentId),
}));

export const insertExtractedRuleSchema = createInsertSchema(extractedRulesTable).omit({ id: true, createdAt: true });
export type InsertExtractedRule = z.infer<typeof insertExtractedRuleSchema>;
export type ExtractedRuleRow = typeof extractedRulesTable.$inferSelect;

export const extractedRuleSchema = z.object({
  id: z.string(),
  document_name: z.string(),
  section: z.string(),
  rule_title: z.string(),
  rule_text: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
});
export type ExtractedRule = z.infer<typeof extractedRuleSchema>;

export const ruleReferenceSchema = z.object({
  rule_id: z.string(),
  document_name: z.string(),
  section: z.string(),
  rule_text: z.string(),
  summary: z.string(),
});
export type RuleReference = z.infer<typeof ruleReferenceSchema>;

export const warningLevelSchema = z.enum(["violation", "risk"]);
export type WarningLevel = z.infer<typeof warningLevelSchema>;

export const warningSchema = z.object({
  id: z.string(),
  level: warningLevelSchema,
  title: z.string(),
  explanation: z.string(),
  transcript_snippet: z.string(),
  rule_reference: ruleReferenceSchema,
  suggested_questions: z.array(z.string()),
  createdAt: z.string(),
  isNew: z.boolean().optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const uploadedDocumentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  uploadedAt: z.string(),
  rulesExtracted: z.number(),
  status: z.enum(["processing", "ready", "error"]),
  errorMessage: z.string().optional(),
});
export type UploadedDocument = z.infer<typeof uploadedDocumentSchema>;

export const rulesStateSchema = z.object({
  documents: z.array(uploadedDocumentSchema),
  rules: z.array(extractedRuleSchema),
  lastUpdated: z.string().optional(),
});
export type RulesState = z.infer<typeof rulesStateSchema>;

export const ruleUploadResponseSchema = z.object({
  success: z.boolean(),
  document: uploadedDocumentSchema.optional(),
  rules: z.array(extractedRuleSchema).optional(),
  error: z.string().optional(),
});
export type RuleUploadResponse = z.infer<typeof ruleUploadResponseSchema>;

export const analyzeWithRulesResponseSchema = z.object({
  questions: z.array(z.string()),
  warnings: z.array(warningSchema).optional(),
});
export type AnalyzeWithRulesResponse = z.infer<typeof analyzeWithRulesResponseSchema>;

// ============= Word Corrections (custom vocabulary) =============
export const wordCorrections = pgTable("word_corrections", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  original: varchar("original", { length: 255 }).notNull(),
  corrected: varchar("corrected", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_word_corrections_user").on(t.userId),
}));

export const insertWordCorrectionSchema = createInsertSchema(wordCorrections).omit({ id: true, createdAt: true });
export type InsertWordCorrection = z.infer<typeof insertWordCorrectionSchema>;
export type WordCorrection = typeof wordCorrections.$inferSelect;

// ============= Intervjutrening =============

export const interviewCriterionSchema = z.enum([
  "konkretisering",
  "fagdybde",
  "eierskap",
  "refleksjon",
  "samhandling",
  "struktur",
]);
export type InterviewCriterion = z.infer<typeof interviewCriterionSchema>;

export const interviewCriterionLabels: Record<InterviewCriterion, string> = {
  konkretisering: "Konkretiseringsevne",
  fagdybde: "Erfaringsdybde",
  eierskap: "Eierskap & rolle",
  refleksjon: "Refleksjon & læring",
  samhandling: "Samhandling",
  struktur: "Struktur & klarhet",
};

export const interviewScoreSchema = z.object({
  score: z.number().min(0).max(10),
  rationale: z.string(),
});
export type InterviewScore = z.infer<typeof interviewScoreSchema>;

export const interviewScoresSchema = z.object({
  konkretisering: interviewScoreSchema,
  fagdybde: interviewScoreSchema,
  eierskap: interviewScoreSchema,
  refleksjon: interviewScoreSchema,
  samhandling: interviewScoreSchema,
  struktur: interviewScoreSchema,
});
export type InterviewScores = z.infer<typeof interviewScoresSchema>;

export const starStatusSchema = z.object({
  situation: z.boolean(),
  task: z.boolean(),
  action: z.boolean(),
  result: z.boolean(),
});
export type StarStatus = z.infer<typeof starStatusSchema>;

export const interviewEvalSnapshotSchema = z.object({
  at: z.string(),
  minute: z.number(),
  scores: interviewScoresSchema,
  star: starStatusSchema,
  candidateWordCount: z.number(),
});
export type InterviewEvalSnapshot = z.infer<typeof interviewEvalSnapshotSchema>;

export const interviewReportSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  finalScores: interviewScoresSchema,
  generatedAt: z.string(),
});
export type InterviewReport = z.infer<typeof interviewReportSchema>;

export const interviewSessions = pgTable("interview_sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  title: varchar("title", { length: 255 }),
  industry: varchar("industry", { length: 50 }).default("bygg"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  elapsedSeconds: integer("elapsed_seconds").default(0),
  transcript: jsonb("transcript").$type<TranscriptSegment[]>().default([]),
  // Latest live evaluation (overwritten each minute)
  currentScores: jsonb("current_scores").$type<InterviewScores | null>().default(null),
  currentStar: jsonb("current_star").$type<StarStatus | null>().default(null),
  // Full history of evaluations through the interview (for trend chart)
  evalHistory: jsonb("eval_history").$type<InterviewEvalSnapshot[]>().default([]),
  // Final report generated when interview is ended
  report: jsonb("report").$type<InterviewReport | null>().default(null),
}, (t) => ({
  userIdx: index("idx_interview_sessions_user").on(t.userId),
}));

export const insertInterviewSessionSchema = createInsertSchema(interviewSessions).omit({ id: true, startedAt: true });
export type InsertInterviewSession = z.infer<typeof insertInterviewSessionSchema>;
export type InterviewSession = typeof interviewSessions.$inferSelect;

// ============= Skjermbilder med AI-tolkning =============

export const meetingScreenshots = pgTable("meeting_screenshots", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionId: integer("session_id"),
  imageData: text("image_data").notNull(),
  mimeType: varchar("mime_type", { length: 50 }).notNull().default("image/jpeg"),
  description: text("description").notNull(),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  includedInSummary: boolean("included_in_summary").notNull().default(false),
}, (t) => ({
  userIdx: index("idx_meeting_screenshots_user").on(t.userId),
  sessionIdx: index("idx_meeting_screenshots_session").on(t.sessionId),
}));

export const insertMeetingScreenshotSchema = createInsertSchema(meetingScreenshots).omit({ id: true, capturedAt: true });
export type InsertMeetingScreenshot = z.infer<typeof insertMeetingScreenshotSchema>;
export type MeetingScreenshot = typeof meetingScreenshots.$inferSelect;

// ============= Kollektiv læring (anonymisert, opt-out) =============

export const communitySignalTypeSchema = z.enum([
  "missed_action",
  "missed_decision",
  "rejected_pattern",
  "summary_pattern",
]);
export type CommunitySignalType = z.infer<typeof communitySignalTypeSchema>;

export const communitySignalStatusSchema = z.enum(["candidate", "canary", "promoted", "demoted"]);
export type CommunitySignalStatus = z.infer<typeof communitySignalStatusSchema>;

export const communitySignals = pgTable("community_signals", {
  id: serial("id").primaryKey(),
  signalType: varchar("signal_type", { length: 32 }).notNull(),
  // Den abstrakte regelen — universell, anonymisert.
  // F.eks. "Når noen sier 'kan du sende meg X innen Y' → fang som aksjon."
  pattern: text("pattern").notNull(),
  // Anonymisert eksempel-utdrag fra transkriptet (uten PII).
  evidence: text("evidence"),
  // candidate (samles, ikke aktiv) → canary (testes på små % av kall) → promoted (full live) → demoted (lav kvalitet, deaktivert)
  status: varchar("status", { length: 16 }).notNull().default("candidate"),
  // Hvor mange unike brukere har bidratt til dette mønsteret
  contributors: integer("contributors").notNull().default(1),
  // Outcome-tracking under canary/promoted-fase
  canaryHits: integer("canary_hits").notNull().default(0),
  canaryWins: integer("canary_wins").notNull().default(0),
  canaryLosses: integer("canary_losses").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("idx_community_signals_status").on(t.status),
  typeIdx: index("idx_community_signals_type").on(t.signalType),
}));

export type CommunitySignal = typeof communitySignals.$inferSelect;
export const insertCommunitySignalSchema = createInsertSchema(communitySignals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCommunitySignal = z.infer<typeof insertCommunitySignalSchema>;

// ============= AI usage tracking =============

export const aiUsageLog = pgTable("ai_usage_log", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id"),
  endpoint: varchar("endpoint", { length: 64 }).notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  // Estimat i USD millicent (0.001 USD), så vi kan summere uten desimaler.
  costMicrocents: integer("cost_microcents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_ai_usage_log_user").on(t.userId),
  endpointIdx: index("idx_ai_usage_log_endpoint").on(t.endpoint),
  createdIdx: index("idx_ai_usage_log_created").on(t.createdAt),
}));

export type AiUsageLogEntry = typeof aiUsageLog.$inferSelect;

// ============= Erfaringsmøter + RAG-hjerne =============

/**
 * Erfaringsmøter er reflekterende samtaler der vi deler lærdommer og
 * forbedringer. Skiller seg fra `meeting_sessions` ved at output-en er
 * strukturerte lærdommer (ikke aksjoner/beslutninger), og at hele
 * transkriptet + hver lærdom mates inn i RAG-hjernen for senere oppslag.
 */
/**
 * Erfaringsmøter kan grupperes i serier (prosjekter, fagområder osv.) slik
 * at AI kan se lærdommer fra tidligere sesjoner i samme kontekst og foreslå
 * oppfølging eller flagge gjentagende mønstre.
 */
export const experienceSeries = pgTable("experience_series", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_experience_series_user").on(t.userId),
}));

export const insertExperienceSeriesSchema = createInsertSchema(experienceSeries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExperienceSeries = z.infer<typeof insertExperienceSeriesSchema>;
export type ExperienceSeries = typeof experienceSeries.$inferSelect;

export const experienceSessions = pgTable("experience_sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  title: varchar("title", { length: 255 }),
  // Valgfri kobling til en serie/prosjekt. NULL = frittstående sesjon.
  seriesId: integer("series_id"),
  // Tema/domene for møtet — f.eks. "taktplanlegging i bygg" eller
  // "lean construction". Brukes som Whisper-prompt for å bias transkripsjon
  // mot rett vokabular og som kontekst når AI ekstraherer lærdommer.
  topic: text("topic"),
  // Lyd-språk: 'no' (norsk), 'en' (engelsk), 'auto' (la Whisper detektere).
  // Default 'no'. Hvis foredragsholderen snakker engelsk men du har låst til
  // 'no', vil Whisper produsere garbled output. 'auto' lar Whisper finne
  // det selv. Sammen med AI-renskriving sikrer dette norsk output uansett.
  language: varchar("language", { length: 8 }).notNull().default("no"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  elapsedSeconds: integer("elapsed_seconds").default(0),
  transcript: jsonb("transcript").$type<TranscriptSegment[]>().default([]),
  speakerMappings: jsonb("speaker_mappings").$type<Record<string, string>>().default({}),
  userNotes: text("user_notes"),
  // Når AI ekstraherte lærdommer. NULL = ikke ekstrahert ennå.
  lessonsExtractedAt: timestamp("lessons_extracted_at"),
}, (t) => ({
  userIdx: index("idx_experience_sessions_user").on(t.userId),
  seriesIdx: index("idx_experience_sessions_series").on(t.seriesId),
}));

/**
 * Vedlegg knyttet til en erfaringsmøte-sesjon. Brukeren kan laste opp
 * dokumenter (PDF/Word/Excel) som diskuteres under møtet. AI får
 * ekstrahert tekst inn som kontekst ved lærdom-ekstraksjon, og dokumentene
 * blir samtidig embeddet i hjernen.
 */
export const experienceAttachments = pgTable("experience_attachments", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionId: integer("session_id").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  // Ekstrahert tekst fra dokumentet. Lagres inline slik at vi slipper
  // re-parse ved hver ekstraksjon. Filen selv lagres ikke.
  extractedText: text("extracted_text").notNull(),
  bytes: integer("bytes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_experience_attachments_user").on(t.userId),
  sessionIdx: index("idx_experience_attachments_session").on(t.sessionId),
}));

export type ExperienceAttachment = typeof experienceAttachments.$inferSelect;
export const insertExperienceAttachmentSchema = createInsertSchema(experienceAttachments).omit({
  id: true,
  createdAt: true,
});
export type InsertExperienceAttachment = z.infer<typeof insertExperienceAttachmentSchema>;

/**
 * Engangs-tokens som lar en uautentisert mobil-side laste opp filer til en
 * spesifikk erfaringsmøte-sesjon. Generert via QR-paring fra desktop-appen.
 * Tokenet inneholder ingen brukerdata selv — vi slår opp sessionId + userId
 * via dette oppslaget. Utløpstid (default 1 time) hindrer langvarig misbruk.
 */
export const experienceUploadTokens = pgTable("experience_upload_tokens", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  userId: uuid("user_id").notNull(),
  sessionId: integer("session_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  tokenIdx: index("idx_experience_upload_tokens_token").on(t.token),
  expiryIdx: index("idx_experience_upload_tokens_expiry").on(t.expiresAt),
}));

export type ExperienceUploadToken = typeof experienceUploadTokens.$inferSelect;

export const insertExperienceSessionSchema = createInsertSchema(experienceSessions).omit({
  id: true,
  startedAt: true,
});
export type InsertExperienceSession = z.infer<typeof insertExperienceSessionSchema>;
export type ExperienceSession = typeof experienceSessions.$inferSelect;

export const lessonTypeSchema = z.enum(["short", "thematic"]);
export type LessonType = z.infer<typeof lessonTypeSchema>;

/**
 * En lærdom er en strukturert observasjon ekstrahert fra et erfaringsmøte
 * (eller manuelt opprettet senere). AI velger granularitet per case —
 * `short` = 1-3 setninger, `thematic` = lengre tematisk blokk.
 */
export const lessonsLearned = pgTable("lessons_learned", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sessionId: integer("session_id"), // fk experience_sessions, nullable
  title: varchar("title", { length: 255 }).notNull(),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  context: text("context"),
  type: varchar("type", { length: 16 }).notNull().default("short"),
  tags: text("tags").array().default([]),
  // Oppfølgings-status: 'open' (default ved opprettelse), 'in_progress'
  // (under utprøving), 'verified' (bekreftet å fungere), 'superseded' (ikke
  // lenger aktuelt). AI bruker dette til å foreslå oppfølging i neste
  // sesjon i samme serie.
  status: varchar("status", { length: 24 }).notNull().default("open"),
  // IDer av screenshots og meeting_documents fra opphavsmøtet som ble vevet
  // inn som rik kontekst for denne lærdommen.
  relatedScreenshotIds: integer("related_screenshot_ids").array().default([]),
  relatedDocumentIds: integer("related_document_ids").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_lessons_learned_user").on(t.userId),
  sessionIdx: index("idx_lessons_learned_session").on(t.sessionId),
}));

export const lessonStatusSchema = z.enum(["open", "in_progress", "verified", "superseded"]);
export type LessonStatus = z.infer<typeof lessonStatusSchema>;

export const insertLessonLearnedSchema = createInsertSchema(lessonsLearned).omit({
  id: true,
  createdAt: true,
});
export type InsertLessonLearned = z.infer<typeof insertLessonLearnedSchema>;
export type LessonLearned = typeof lessonsLearned.$inferSelect;

export const knowledgeSourceTypeSchema = z.enum([
  "lesson",
  "meeting_summary",
  "meeting_transcript",
  "experience_transcript",
  "rule",
  "uploaded_doc",
  "uploaded_image",
]);
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;

/**
 * RAG-hjernens minne: hver rad er en embeddet "chunk" tekst som er hentet
 * fra én av kildetypene over. Brukeren kan stille spørsmål på `/hjernen`,
 * vi gjør cosine similarity-søk i denne tabellen (HNSW-indeks for fart),
 * og mater top-K chunks som kontekst til gpt-5.
 *
 * Embedding-dimensjon 1536 = OpenAI `text-embedding-3-small`.
 */
export const knowledgeChunks = pgTable("knowledge_chunks", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  // ID i opphavstabellen. Nullable for ad-hoc opplastede dokumenter som
  // ikke har en egen rad noe annet sted.
  sourceId: integer("source_id"),
  sourceName: varchar("source_name", { length: 255 }).notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_knowledge_chunks_user").on(t.userId),
  sourceIdx: index("idx_knowledge_chunks_source").on(t.sourceType, t.sourceId),
  // HNSW-indeksen lages via script/apply-extensions.ts (Drizzle støtter ikke
  // pgvector-operator-classes på indeks ennå). Lar default B-tree være.
}));

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export const insertKnowledgeChunkSchema = createInsertSchema(knowledgeChunks).omit({
  id: true,
  createdAt: true,
});
export type InsertKnowledgeChunk = z.infer<typeof insertKnowledgeChunkSchema>;

// ============= Frontend-typer for lærdom-forslag (før godkjenning) =============

export const proposedLessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  problem: z.string(),
  solution: z.string(),
  context: z.string().optional(),
  type: lessonTypeSchema,
  tags: z.array(z.string()).default([]),
  relatedScreenshotIds: z.array(z.number()).default([]),
  relatedDocumentIds: z.array(z.number()).default([]),
  // Hvis AI mener denne lærdommen oppdaterer en eksisterende lærdom fra
  // samme prosjekt/serie, oppgis dens id her. Brukeren kan da bekrefte
  // oppfølging eller avvise koblingen.
  relatesToLessonId: z.number().nullable().optional(),
});
export type ProposedLesson = z.infer<typeof proposedLessonSchema>;

// ============= Chat mot RAG-hjernen =============

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const knowledgeSourceRefSchema = z.object({
  chunkId: z.number(),
  sourceType: knowledgeSourceTypeSchema,
  sourceId: z.number().nullable(),
  sourceName: z.string(),
  excerpt: z.string(),
  score: z.number(),
});
export type KnowledgeSourceRef = z.infer<typeof knowledgeSourceRefSchema>;
