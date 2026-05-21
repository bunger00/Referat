import { voiceProfiles, meetingSessions, meetingSeries, meetingDocuments, ruleDocuments, extractedRulesTable, feedbackLog, aiPreferences, summaryFeedback, summaryPreferences, wordCorrections, interviewSessions, meetingScreenshots, communitySignals, experienceSessions, lessonsLearned, experienceSeries, experienceAttachments, experienceUploadTokens, type VoiceProfile, type InsertVoiceProfile, type MeetingSession, type InsertMeetingSession, type MeetingSeriesRow, type InsertMeetingSeries, type MeetingDocument, type InsertMeetingDocument, type ExtractedRule, type UploadedDocument, type RulesState, type InsertRuleDocument, type InsertExtractedRule, type FeedbackLogEntry, type AiPreferences, type SummaryFeedbackEntry, type SummaryPreferences, type WordCorrection, type InterviewSession, type InsertInterviewSession, type MeetingScreenshot, type InsertMeetingScreenshot, type CommunitySignal, type InsertCommunitySignal, type ExperienceSession, type InsertExperienceSession, type LessonLearned, type InsertLessonLearned, type ExperienceSeries, type InsertExperienceSeries, type ExperienceAttachment, type InsertExperienceAttachment, type ExperienceUploadToken } from "@shared/schema";
import { gt } from "drizzle-orm";
import { db } from "./db";
import { eq, desc, and, inArray } from "drizzle-orm";

// Every per-user method takes userId from the JWT-validated request and
// scopes the query to that user's rows. There's no "global" scope for owned
// data — the only way to read another user's data would be to bypass this
// layer (which the routes are not allowed to do).

export interface IStorage {
  getVoiceProfiles(): Promise<VoiceProfile[]>;
  getVoiceProfile(id: number): Promise<VoiceProfile | undefined>;
  createVoiceProfile(profile: InsertVoiceProfile): Promise<VoiceProfile>;
  deleteVoiceProfile(id: number): Promise<boolean>;

  // Meeting sessions
  getMeetingSessions(userId: string): Promise<MeetingSession[]>;
  getMeetingSession(userId: string, id: number): Promise<MeetingSession | undefined>;
  createMeetingSession(userId: string, session: Omit<InsertMeetingSession, "userId">): Promise<MeetingSession>;
  updateMeetingSession(userId: string, id: number, updates: Record<string, unknown>): Promise<MeetingSession | undefined>;
  deleteMeetingSession(userId: string, id: number): Promise<boolean>;

  // Meeting series
  getMeetingSeriesList(userId: string): Promise<MeetingSeriesRow[]>;
  getMeetingSeriesById(userId: string, id: number): Promise<MeetingSeriesRow | undefined>;
  createMeetingSeries(userId: string, series: Omit<InsertMeetingSeries, "userId">): Promise<MeetingSeriesRow>;
  updateMeetingSeries(userId: string, id: number, updates: Partial<Omit<InsertMeetingSeries, "userId">>): Promise<MeetingSeriesRow | undefined>;
  updateSeriesNameOnSessions(userId: string, seriesId: number, newName: string): Promise<void>;
  deleteMeetingSeries(userId: string, id: number): Promise<boolean>;
  getSessionsInSeries(userId: string, seriesId: number): Promise<MeetingSession[]>;

  // Meeting documents
  getMeetingDocuments(userId: string, sessionId?: number, seriesId?: number): Promise<MeetingDocument[]>;
  createMeetingDocument(userId: string, doc: Omit<InsertMeetingDocument, "userId">): Promise<MeetingDocument>;
  deleteMeetingDocument(userId: string, id: number): Promise<boolean>;

  // Rules (persistent in database)
  getRulesState(userId: string): Promise<RulesState>;
  addDocument(userId: string, document: Omit<InsertRuleDocument, "userId">): Promise<number>;
  updateDocumentStatus(userId: string, documentId: number, status: string, rulesExtracted?: number, errorMessage?: string): Promise<void>;
  addRules(userId: string, rules: Omit<InsertExtractedRule, "userId">[]): Promise<void>;
  clearRules(userId: string): Promise<void>;
  removeDocument(userId: string, documentId: number): Promise<void>;

  // Learning / Feedback
  logFeedback(userId: string, entry: { type: string; text: string; context?: string; accepted: boolean; reason?: string; expertRole?: string; source?: string }): Promise<void>;
  getFeedbackLog(userId: string): Promise<FeedbackLogEntry[]>;
  getAiPreferences(userId: string): Promise<AiPreferences | null>;
  setAiPreferences(userId: string, profileText: string, signalCount: number): Promise<void>;
  logSummaryFeedback(userId: string, commentText: string, summaryExcerpt?: string): Promise<void>;
  getSummaryFeedbackLog(userId: string): Promise<SummaryFeedbackEntry[]>;
  getSummaryPreferences(userId: string): Promise<SummaryPreferences | null>;
  setSummaryPreferences(userId: string, profileText: string, feedbackCount: number): Promise<void>;

  // Word corrections
  getWordCorrections(userId: string): Promise<WordCorrection[]>;
  upsertWordCorrection(userId: string, original: string, corrected: string): Promise<WordCorrection>;
  deleteWordCorrection(userId: string, id: number): Promise<boolean>;

  // Interview training
  getInterviewSessions(userId: string): Promise<InterviewSession[]>;
  getInterviewSession(userId: string, id: number): Promise<InterviewSession | undefined>;
  createInterviewSession(userId: string, data: Omit<InsertInterviewSession, "userId">): Promise<InterviewSession>;
  updateInterviewSession(userId: string, id: number, updates: Record<string, unknown>): Promise<InterviewSession | undefined>;
  deleteInterviewSession(userId: string, id: number): Promise<boolean>;

  // Meeting screenshots
  getMeetingScreenshots(userId: string, sessionId?: number): Promise<MeetingScreenshot[]>;
  createMeetingScreenshot(userId: string, data: Omit<InsertMeetingScreenshot, "userId">): Promise<MeetingScreenshot>;
  updateMeetingScreenshot(userId: string, id: number, updates: Record<string, unknown>): Promise<MeetingScreenshot | undefined>;
  deleteMeetingScreenshot(userId: string, id: number): Promise<boolean>;

  // Experience sessions (erfaringsmøter — reflekterende samtaler som mater RAG-hjernen)
  getExperienceSessions(userId: string): Promise<ExperienceSession[]>;
  getExperienceSession(userId: string, id: number): Promise<ExperienceSession | undefined>;
  createExperienceSession(userId: string, data: Omit<InsertExperienceSession, "userId">): Promise<ExperienceSession>;
  updateExperienceSession(userId: string, id: number, updates: Record<string, unknown>): Promise<ExperienceSession | undefined>;
  deleteExperienceSession(userId: string, id: number): Promise<boolean>;

  // Experience series (prosjekt-/temagruppering for erfaringsmøter)
  getExperienceSeries(userId: string): Promise<ExperienceSeries[]>;
  getExperienceSeriesById(userId: string, id: number): Promise<ExperienceSeries | undefined>;
  createExperienceSeries(userId: string, data: Omit<InsertExperienceSeries, "userId">): Promise<ExperienceSeries>;
  updateExperienceSeries(userId: string, id: number, updates: Partial<Omit<InsertExperienceSeries, "userId">>): Promise<ExperienceSeries | undefined>;
  deleteExperienceSeries(userId: string, id: number): Promise<boolean>;
  getSessionsInExperienceSeries(userId: string, seriesId: number): Promise<ExperienceSession[]>;

  // Experience attachments (dokumenter knyttet til en erfaringsmøte-sesjon).
  // getExperienceAttachments returnerer IKKE imageData (kan være flere MB
  // base64 per bilde). Bruk getExperienceAttachment(id) når du faktisk
  // trenger bildet (visningsdialog, /image-endepunktet).
  getExperienceAttachments(userId: string, sessionId: number): Promise<ExperienceAttachment[]>;
  getExperienceAttachment(userId: string, id: number): Promise<ExperienceAttachment | undefined>;
  createExperienceAttachment(userId: string, data: Omit<InsertExperienceAttachment, "userId">): Promise<ExperienceAttachment>;
  deleteExperienceAttachment(userId: string, id: number): Promise<boolean>;

  // Lessons learned (strukturerte lærdommer fra erfaringsmøter)
  getLessons(userId: string): Promise<LessonLearned[]>;
  getLessonsForSession(userId: string, sessionId: number): Promise<LessonLearned[]>;
  getLessonsInSeries(userId: string, seriesId: number): Promise<LessonLearned[]>;
  createLesson(userId: string, data: Omit<InsertLessonLearned, "userId">): Promise<LessonLearned>;
  updateLesson(userId: string, id: number, updates: Record<string, unknown>): Promise<LessonLearned | undefined>;
  deleteLesson(userId: string, id: number): Promise<boolean>;

  // Community learning (cross-user, anonymized)
  getCommunitySignals(filter?: { status?: string; signalType?: string }): Promise<CommunitySignal[]>;
  createCommunitySignal(data: InsertCommunitySignal): Promise<CommunitySignal>;
  updateCommunitySignal(id: number, updates: Record<string, unknown>): Promise<CommunitySignal | undefined>;
  incrementSignalContributors(id: number): Promise<void>;
  setCommunityOptOut(userId: string, optOut: boolean): Promise<void>;
  incrementCommunityContributions(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Voice profiles are not currently surfaced as user data; left global for now.
  async getVoiceProfiles(): Promise<VoiceProfile[]> {
    return await db.select().from(voiceProfiles);
  }
  async getVoiceProfile(id: number): Promise<VoiceProfile | undefined> {
    const [profile] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.id, id));
    return profile || undefined;
  }
  async createVoiceProfile(insertProfile: InsertVoiceProfile): Promise<VoiceProfile> {
    const [profile] = await db.insert(voiceProfiles).values(insertProfile).returning();
    return profile;
  }
  async deleteVoiceProfile(id: number): Promise<boolean> {
    const result = await db.delete(voiceProfiles).where(eq(voiceProfiles.id, id)).returning();
    return result.length > 0;
  }

  // Meeting sessions
  async getMeetingSessions(userId: string): Promise<MeetingSession[]> {
    return await db.select().from(meetingSessions)
      .where(eq(meetingSessions.userId, userId))
      .orderBy(desc(meetingSessions.startedAt));
  }

  async getMeetingSession(userId: string, id: number): Promise<MeetingSession | undefined> {
    const [session] = await db.select().from(meetingSessions)
      .where(and(eq(meetingSessions.id, id), eq(meetingSessions.userId, userId)));
    return session || undefined;
  }

  async createMeetingSession(userId: string, insertSession: Omit<InsertMeetingSession, "userId">): Promise<MeetingSession> {
    const [session] = await db.insert(meetingSessions)
      .values([{ ...insertSession, userId } as any])
      .returning();
    return session;
  }

  async updateMeetingSession(userId: string, id: number, updates: Record<string, unknown>): Promise<MeetingSession | undefined> {
    const [session] = await db.update(meetingSessions)
      .set(updates as any)
      .where(and(eq(meetingSessions.id, id), eq(meetingSessions.userId, userId)))
      .returning();
    return session || undefined;
  }

  async deleteMeetingSession(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(meetingSessions)
      .where(and(eq(meetingSessions.id, id), eq(meetingSessions.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // Meeting series
  async getMeetingSeriesList(userId: string): Promise<MeetingSeriesRow[]> {
    return await db.select().from(meetingSeries)
      .where(eq(meetingSeries.userId, userId))
      .orderBy(desc(meetingSeries.createdAt));
  }

  async getMeetingSeriesById(userId: string, id: number): Promise<MeetingSeriesRow | undefined> {
    const [row] = await db.select().from(meetingSeries)
      .where(and(eq(meetingSeries.id, id), eq(meetingSeries.userId, userId)));
    return row || undefined;
  }

  async createMeetingSeries(userId: string, series: Omit<InsertMeetingSeries, "userId">): Promise<MeetingSeriesRow> {
    const [row] = await db.insert(meetingSeries).values({ ...series, userId } as any).returning();
    return row;
  }

  async updateMeetingSeries(userId: string, id: number, updates: Partial<Omit<InsertMeetingSeries, "userId">>): Promise<MeetingSeriesRow | undefined> {
    const [row] = await db.update(meetingSeries)
      .set(updates as any)
      .where(and(eq(meetingSeries.id, id), eq(meetingSeries.userId, userId)))
      .returning();
    return row || undefined;
  }

  async updateSeriesNameOnSessions(userId: string, seriesId: number, newName: string): Promise<void> {
    await db.update(meetingSessions)
      .set({ seriesName: newName })
      .where(and(eq(meetingSessions.seriesId, seriesId), eq(meetingSessions.userId, userId)));
  }

  async deleteMeetingSeries(userId: string, id: number): Promise<boolean> {
    await db.update(meetingSessions)
      .set({ seriesId: null })
      .where(and(eq(meetingSessions.seriesId, id), eq(meetingSessions.userId, userId)));
    const result = await db.delete(meetingSeries)
      .where(and(eq(meetingSeries.id, id), eq(meetingSeries.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async getSessionsInSeries(userId: string, seriesId: number): Promise<MeetingSession[]> {
    return await db.select().from(meetingSessions)
      .where(and(eq(meetingSessions.seriesId, seriesId), eq(meetingSessions.userId, userId)))
      .orderBy(meetingSessions.startedAt);
  }

  // Meeting documents
  async getMeetingDocuments(userId: string, sessionId?: number, seriesId?: number): Promise<MeetingDocument[]> {
    const rows = await db.select().from(meetingDocuments)
      .where(eq(meetingDocuments.userId, userId))
      .orderBy(desc(meetingDocuments.createdAt));
    return rows.filter(d => {
      if (sessionId && d.sessionId === sessionId) return true;
      if (seriesId && d.seriesId === seriesId) return true;
      if (!sessionId && !seriesId) return true;
      return false;
    });
  }

  async createMeetingDocument(userId: string, doc: Omit<InsertMeetingDocument, "userId">): Promise<MeetingDocument> {
    const [row] = await db.insert(meetingDocuments).values({ ...doc, userId } as any).returning();
    return row;
  }

  async deleteMeetingDocument(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(meetingDocuments)
      .where(and(eq(meetingDocuments.id, id), eq(meetingDocuments.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // Rules
  async getRulesState(userId: string): Promise<RulesState> {
    const docs = await db.select().from(ruleDocuments)
      .where(eq(ruleDocuments.userId, userId))
      .orderBy(desc(ruleDocuments.uploadedAt));
    const rules = await db.select().from(extractedRulesTable)
      .where(eq(extractedRulesTable.userId, userId))
      .orderBy(extractedRulesTable.createdAt);

    const documents: UploadedDocument[] = docs.map(doc => ({
      id: String(doc.id),
      filename: doc.filename,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      size: doc.size,
      uploadedAt: doc.uploadedAt.toISOString(),
      rulesExtracted: doc.rulesExtracted || 0,
      status: doc.status as "processing" | "ready" | "error",
      errorMessage: doc.errorMessage || undefined,
    }));

    const extractedRules: ExtractedRule[] = rules.map(rule => ({
      id: rule.externalRuleId,
      document_name: rule.documentName,
      section: rule.section,
      rule_title: rule.ruleTitle,
      rule_text: rule.ruleText,
      summary: rule.summary,
      tags: rule.tags || [],
    }));

    return {
      documents,
      rules: extractedRules,
      lastUpdated: docs.length > 0 ? docs[0].uploadedAt.toISOString() : undefined,
    };
  }

  async addDocument(userId: string, document: Omit<InsertRuleDocument, "userId">): Promise<number> {
    const [doc] = await db.insert(ruleDocuments).values({ ...document, userId } as any).returning();
    return doc.id;
  }

  async updateDocumentStatus(userId: string, documentId: number, status: string, rulesExtracted?: number, errorMessage?: string): Promise<void> {
    const updates: Record<string, any> = { status };
    if (rulesExtracted !== undefined) updates.rulesExtracted = rulesExtracted;
    if (errorMessage !== undefined) updates.errorMessage = errorMessage;
    await db.update(ruleDocuments).set(updates)
      .where(and(eq(ruleDocuments.id, documentId), eq(ruleDocuments.userId, userId)));
  }

  async addRules(userId: string, rules: Omit<InsertExtractedRule, "userId">[]): Promise<void> {
    if (rules.length > 0) {
      await db.insert(extractedRulesTable).values(rules.map(r => ({ ...r, userId } as any)));
    }
  }

  async clearRules(userId: string): Promise<void> {
    await db.delete(extractedRulesTable).where(eq(extractedRulesTable.userId, userId));
    await db.delete(ruleDocuments).where(eq(ruleDocuments.userId, userId));
  }

  async removeDocument(userId: string, documentId: number): Promise<void> {
    await db.delete(extractedRulesTable)
      .where(and(eq(extractedRulesTable.documentId, documentId), eq(extractedRulesTable.userId, userId)));
    await db.delete(ruleDocuments)
      .where(and(eq(ruleDocuments.id, documentId), eq(ruleDocuments.userId, userId)));
  }

  // Learning / Feedback
  async logFeedback(userId: string, entry: { type: string; text: string; context?: string; accepted: boolean; reason?: string; expertRole?: string; source?: string }): Promise<void> {
    await db.insert(feedbackLog).values({
      userId,
      type: entry.type,
      text: entry.text,
      context: entry.context || null,
      accepted: entry.accepted,
      reason: entry.reason || null,
      expertRole: entry.expertRole || null,
      source: entry.source || "ai",
    });
  }

  async getFeedbackLog(userId: string): Promise<FeedbackLogEntry[]> {
    return await db.select().from(feedbackLog)
      .where(eq(feedbackLog.userId, userId))
      .orderBy(desc(feedbackLog.createdAt));
  }

  async getAiPreferences(userId: string): Promise<AiPreferences | null> {
    const [row] = await db.select().from(aiPreferences).where(eq(aiPreferences.userId, userId));
    return row || null;
  }

  async setAiPreferences(userId: string, profileText: string, signalCount: number): Promise<void> {
    const existing = await this.getAiPreferences(userId);
    if (existing) {
      await db.update(aiPreferences)
        .set({ profileText, signalCount, updatedAt: new Date() })
        .where(eq(aiPreferences.userId, userId));
    } else {
      await db.insert(aiPreferences).values({ userId, profileText, signalCount } as any);
    }
  }

  async logSummaryFeedback(userId: string, commentText: string, summaryExcerpt?: string): Promise<void> {
    await db.insert(summaryFeedback).values({ userId, commentText, summaryExcerpt: summaryExcerpt || null });
  }

  async getSummaryFeedbackLog(userId: string): Promise<SummaryFeedbackEntry[]> {
    return await db.select().from(summaryFeedback)
      .where(eq(summaryFeedback.userId, userId))
      .orderBy(desc(summaryFeedback.createdAt));
  }

  async getSummaryPreferences(userId: string): Promise<SummaryPreferences | null> {
    const [row] = await db.select().from(summaryPreferences).where(eq(summaryPreferences.userId, userId));
    return row || null;
  }

  async setSummaryPreferences(userId: string, profileText: string, feedbackCount: number): Promise<void> {
    const existing = await this.getSummaryPreferences(userId);
    if (existing) {
      await db.update(summaryPreferences)
        .set({ profileText, feedbackCount, updatedAt: new Date() })
        .where(eq(summaryPreferences.userId, userId));
    } else {
      await db.insert(summaryPreferences).values({ userId, profileText, feedbackCount } as any);
    }
  }

  // Word corrections
  async getWordCorrections(userId: string): Promise<WordCorrection[]> {
    return await db.select().from(wordCorrections)
      .where(eq(wordCorrections.userId, userId))
      .orderBy(wordCorrections.createdAt);
  }

  async upsertWordCorrection(userId: string, original: string, corrected: string): Promise<WordCorrection> {
    const [existing] = await db.select().from(wordCorrections)
      .where(and(eq(wordCorrections.original, original), eq(wordCorrections.userId, userId)));
    if (existing) {
      const [updated] = await db.update(wordCorrections)
        .set({ corrected })
        .where(and(eq(wordCorrections.id, existing.id), eq(wordCorrections.userId, userId)))
        .returning();
      return updated;
    }
    const [row] = await db.insert(wordCorrections).values({ userId, original, corrected } as any).returning();
    return row;
  }

  async deleteWordCorrection(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(wordCorrections)
      .where(and(eq(wordCorrections.id, id), eq(wordCorrections.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ============= Interview training =============

  async getInterviewSessions(userId: string): Promise<InterviewSession[]> {
    return await db.select().from(interviewSessions)
      .where(eq(interviewSessions.userId, userId))
      .orderBy(desc(interviewSessions.startedAt));
  }

  async getInterviewSession(userId: string, id: number): Promise<InterviewSession | undefined> {
    const [row] = await db.select().from(interviewSessions)
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.userId, userId)));
    return row;
  }

  async createInterviewSession(userId: string, data: Omit<InsertInterviewSession, "userId">): Promise<InterviewSession> {
    const [row] = await db.insert(interviewSessions).values({ ...data, userId } as any).returning();
    return row;
  }

  async updateInterviewSession(userId: string, id: number, updates: Record<string, unknown>): Promise<InterviewSession | undefined> {
    const [row] = await db.update(interviewSessions)
      .set(updates)
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.userId, userId)))
      .returning();
    return row;
  }

  async deleteInterviewSession(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(interviewSessions)
      .where(and(eq(interviewSessions.id, id), eq(interviewSessions.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ============= Meeting screenshots =============

  async getMeetingScreenshots(userId: string, sessionId?: number): Promise<MeetingScreenshot[]> {
    const rows = await db.select().from(meetingScreenshots)
      .where(eq(meetingScreenshots.userId, userId))
      .orderBy(desc(meetingScreenshots.capturedAt));
    if (sessionId !== undefined) return rows.filter(r => r.sessionId === sessionId);
    return rows;
  }

  async createMeetingScreenshot(userId: string, data: Omit<InsertMeetingScreenshot, "userId">): Promise<MeetingScreenshot> {
    const [row] = await db.insert(meetingScreenshots).values({ ...data, userId } as any).returning();
    return row;
  }

  async updateMeetingScreenshot(userId: string, id: number, updates: Record<string, unknown>): Promise<MeetingScreenshot | undefined> {
    const [row] = await db.update(meetingScreenshots)
      .set(updates)
      .where(and(eq(meetingScreenshots.id, id), eq(meetingScreenshots.userId, userId)))
      .returning();
    return row;
  }

  async deleteMeetingScreenshot(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(meetingScreenshots)
      .where(and(eq(meetingScreenshots.id, id), eq(meetingScreenshots.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ============= Community learning =============

  async getCommunitySignals(filter?: { status?: string; signalType?: string }): Promise<CommunitySignal[]> {
    const all = await db.select().from(communitySignals).orderBy(desc(communitySignals.updatedAt));
    return all.filter(s => {
      if (filter?.status && s.status !== filter.status) return false;
      if (filter?.signalType && s.signalType !== filter.signalType) return false;
      return true;
    });
  }

  async createCommunitySignal(data: InsertCommunitySignal): Promise<CommunitySignal> {
    const [row] = await db.insert(communitySignals).values(data as any).returning();
    return row;
  }

  async updateCommunitySignal(id: number, updates: Record<string, unknown>): Promise<CommunitySignal | undefined> {
    const [row] = await db.update(communitySignals)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(communitySignals.id, id))
      .returning();
    return row;
  }

  async incrementSignalContributors(id: number): Promise<void> {
    const [existing] = await db.select().from(communitySignals).where(eq(communitySignals.id, id));
    if (existing) {
      await db.update(communitySignals)
        .set({ contributors: existing.contributors + 1, updatedAt: new Date() })
        .where(eq(communitySignals.id, id));
    }
  }

  async setCommunityOptOut(userId: string, optOut: boolean): Promise<void> {
    const existing = await this.getAiPreferences(userId);
    if (existing) {
      await db.update(aiPreferences)
        .set({ communityOptOut: optOut, updatedAt: new Date() })
        .where(eq(aiPreferences.userId, userId));
    } else {
      await db.insert(aiPreferences).values({
        userId,
        profileText: "",
        signalCount: 0,
        communityOptOut: optOut,
      } as any);
    }
  }

  async incrementCommunityContributions(userId: string): Promise<void> {
    const existing = await this.getAiPreferences(userId);
    if (existing) {
      await db.update(aiPreferences)
        .set({ communityContributions: existing.communityContributions + 1, updatedAt: new Date() })
        .where(eq(aiPreferences.userId, userId));
    } else {
      await db.insert(aiPreferences).values({
        userId,
        profileText: "",
        signalCount: 0,
        communityContributions: 1,
      } as any);
    }
  }

  // ============= Experience sessions =============

  async getExperienceSessions(userId: string): Promise<ExperienceSession[]> {
    return await db.select().from(experienceSessions)
      .where(eq(experienceSessions.userId, userId))
      .orderBy(desc(experienceSessions.startedAt));
  }

  async getExperienceSession(userId: string, id: number): Promise<ExperienceSession | undefined> {
    const [row] = await db.select().from(experienceSessions)
      .where(and(eq(experienceSessions.id, id), eq(experienceSessions.userId, userId)));
    return row || undefined;
  }

  async createExperienceSession(userId: string, data: Omit<InsertExperienceSession, "userId">): Promise<ExperienceSession> {
    const [row] = await db.insert(experienceSessions)
      .values({ ...data, userId } as any)
      .returning();
    return row;
  }

  async updateExperienceSession(userId: string, id: number, updates: Record<string, unknown>): Promise<ExperienceSession | undefined> {
    const [row] = await db.update(experienceSessions)
      .set(updates as any)
      .where(and(eq(experienceSessions.id, id), eq(experienceSessions.userId, userId)))
      .returning();
    return row || undefined;
  }

  async deleteExperienceSession(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(experienceSessions)
      .where(and(eq(experienceSessions.id, id), eq(experienceSessions.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ============= Lessons learned =============

  async getLessons(userId: string): Promise<LessonLearned[]> {
    return await db.select().from(lessonsLearned)
      .where(eq(lessonsLearned.userId, userId))
      .orderBy(desc(lessonsLearned.createdAt));
  }

  async getLessonsForSession(userId: string, sessionId: number): Promise<LessonLearned[]> {
    return await db.select().from(lessonsLearned)
      .where(and(eq(lessonsLearned.userId, userId), eq(lessonsLearned.sessionId, sessionId)))
      .orderBy(desc(lessonsLearned.createdAt));
  }

  async createLesson(userId: string, data: Omit<InsertLessonLearned, "userId">): Promise<LessonLearned> {
    const [row] = await db.insert(lessonsLearned)
      .values({ ...data, userId } as any)
      .returning();
    return row;
  }

  async updateLesson(userId: string, id: number, updates: Record<string, unknown>): Promise<LessonLearned | undefined> {
    const [row] = await db.update(lessonsLearned)
      .set(updates as any)
      .where(and(eq(lessonsLearned.id, id), eq(lessonsLearned.userId, userId)))
      .returning();
    return row || undefined;
  }

  async deleteLesson(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(lessonsLearned)
      .where(and(eq(lessonsLearned.id, id), eq(lessonsLearned.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async getLessonsInSeries(userId: string, seriesId: number): Promise<LessonLearned[]> {
    const sessions = await db.select({ id: experienceSessions.id }).from(experienceSessions)
      .where(and(eq(experienceSessions.userId, userId), eq(experienceSessions.seriesId, seriesId)));
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) return [];
    return await db.select().from(lessonsLearned)
      .where(and(
        eq(lessonsLearned.userId, userId),
        inArray(lessonsLearned.sessionId, sessionIds),
      ))
      .orderBy(desc(lessonsLearned.createdAt));
  }

  // ============= Experience series =============

  async getExperienceSeries(userId: string): Promise<ExperienceSeries[]> {
    return await db.select().from(experienceSeries)
      .where(eq(experienceSeries.userId, userId))
      .orderBy(desc(experienceSeries.updatedAt));
  }

  async getExperienceSeriesById(userId: string, id: number): Promise<ExperienceSeries | undefined> {
    const [row] = await db.select().from(experienceSeries)
      .where(and(eq(experienceSeries.id, id), eq(experienceSeries.userId, userId)));
    return row || undefined;
  }

  async createExperienceSeries(userId: string, data: Omit<InsertExperienceSeries, "userId">): Promise<ExperienceSeries> {
    const [row] = await db.insert(experienceSeries)
      .values({ ...data, userId } as any)
      .returning();
    return row;
  }

  async updateExperienceSeries(userId: string, id: number, updates: Partial<Omit<InsertExperienceSeries, "userId">>): Promise<ExperienceSeries | undefined> {
    const [row] = await db.update(experienceSeries)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(and(eq(experienceSeries.id, id), eq(experienceSeries.userId, userId)))
      .returning();
    return row || undefined;
  }

  async deleteExperienceSeries(userId: string, id: number): Promise<boolean> {
    // Sett seriesId = null på alle tilhørende sesjoner først så de ikke
    // blir orphan (foreldreløse referanser).
    await db.update(experienceSessions)
      .set({ seriesId: null } as any)
      .where(and(eq(experienceSessions.userId, userId), eq(experienceSessions.seriesId, id)));
    const result = await db.delete(experienceSeries)
      .where(and(eq(experienceSeries.id, id), eq(experienceSeries.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async getSessionsInExperienceSeries(userId: string, seriesId: number): Promise<ExperienceSession[]> {
    return await db.select().from(experienceSessions)
      .where(and(eq(experienceSessions.userId, userId), eq(experienceSessions.seriesId, seriesId)))
      .orderBy(desc(experienceSessions.startedAt));
  }

  // ============= Experience attachments =============

  async getExperienceAttachments(userId: string, sessionId: number): Promise<ExperienceAttachment[]> {
    // Eksplisitt kolonneliste — imageData (base64 av bildet) kan være flere
    // MB per rad, og vi vil ikke laste det på hver sesjons-poll. Klienten
    // henter bildet via getExperienceAttachment når brukeren åpner det.
    const rows = await db.select({
      id: experienceAttachments.id,
      userId: experienceAttachments.userId,
      sessionId: experienceAttachments.sessionId,
      filename: experienceAttachments.filename,
      mimeType: experienceAttachments.mimeType,
      extractedText: experienceAttachments.extractedText,
      bytes: experienceAttachments.bytes,
      createdAt: experienceAttachments.createdAt,
    }).from(experienceAttachments)
      .where(and(
        eq(experienceAttachments.userId, userId),
        eq(experienceAttachments.sessionId, sessionId),
      ))
      .orderBy(desc(experienceAttachments.createdAt));
    // imageData er undefined her — pad ut feltet så typen matcher
    return rows.map((r) => ({ ...r, imageData: null }));
  }

  async getExperienceAttachment(userId: string, id: number): Promise<ExperienceAttachment | undefined> {
    const [row] = await db.select().from(experienceAttachments)
      .where(and(
        eq(experienceAttachments.id, id),
        eq(experienceAttachments.userId, userId),
      ))
      .limit(1);
    return row;
  }

  async createExperienceAttachment(userId: string, data: Omit<InsertExperienceAttachment, "userId">): Promise<ExperienceAttachment> {
    const [row] = await db.insert(experienceAttachments)
      .values({ ...data, userId } as any)
      .returning();
    return row;
  }

  async deleteExperienceAttachment(userId: string, id: number): Promise<boolean> {
    const result = await db.delete(experienceAttachments)
      .where(and(eq(experienceAttachments.id, id), eq(experienceAttachments.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ============= Experience upload tokens (QR-paring) =============

  async createExperienceUploadToken(userId: string, sessionId: number, ttlMs = 60 * 60 * 1000): Promise<ExperienceUploadToken> {
    // 32 byte tilfeldig hex = 64 tegn
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ttlMs);
    const [row] = await db.insert(experienceUploadTokens)
      .values({ token, userId, sessionId, expiresAt } as any)
      .returning();
    return row;
  }

  async lookupExperienceUploadToken(token: string): Promise<ExperienceUploadToken | undefined> {
    if (!token || token.length !== 64) return undefined;
    const [row] = await db.select().from(experienceUploadTokens)
      .where(and(eq(experienceUploadTokens.token, token), gt(experienceUploadTokens.expiresAt, new Date())))
      .limit(1);
    return row || undefined;
  }
}

export const storage = new DatabaseStorage();
