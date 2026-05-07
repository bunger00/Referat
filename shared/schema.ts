import { z } from "zod";
import { pgTable, serial, text, timestamp, varchar, integer, jsonb, boolean, uuid } from "drizzle-orm/pg-core";
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
});

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
});

export const insertMeetingSessionSchema = createInsertSchema(meetingSessions).omit({ id: true, startedAt: true });
export type InsertMeetingSession = z.infer<typeof insertMeetingSessionSchema>;
export type MeetingSession = typeof meetingSessions.$inferSelect;

export const transcribeRequestSchema = z.object({
  audio: z.string(),
  mimeType: z.string().optional(),
  model: z.enum(["medium", "large", "openai"]).optional(),
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
});

export const insertMeetingDocumentSchema = createInsertSchema(meetingDocuments).omit({ id: true, createdAt: true });
export type InsertMeetingDocument = z.infer<typeof insertMeetingDocumentSchema>;
export type MeetingDocument = typeof meetingDocuments.$inferSelect;

// ============= Learning / Feedback Tables =============

export const feedbackLog = pgTable("feedback_log", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: varchar("type", { length: 20 }).notNull(), // "action" | "decision"
  text: text("text").notNull(),
  context: text("context"),
  accepted: boolean("accepted").notNull(),
  reason: text("reason"), // optional rejection reason
  expertRole: varchar("expert_role", { length: 50 }),
  source: varchar("source", { length: 10 }).default("ai"), // "ai" | "manual"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type FeedbackLogEntry = typeof feedbackLog.$inferSelect;

export const aiPreferences = pgTable("ai_preferences", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().unique(),
  profileText: text("profile_text").notNull().default(""),
  signalCount: integer("signal_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AiPreferences = typeof aiPreferences.$inferSelect;

export const summaryFeedback = pgTable("summary_feedback", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  commentText: text("comment_text").notNull(),
  summaryExcerpt: text("summary_excerpt"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
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
});

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
});

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
});

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
});

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
});

export const insertMeetingScreenshotSchema = createInsertSchema(meetingScreenshots).omit({ id: true, capturedAt: true });
export type InsertMeetingScreenshot = z.infer<typeof insertMeetingScreenshotSchema>;
export type MeetingScreenshot = typeof meetingScreenshots.$inferSelect;
