import { voiceProfiles, meetingSessions, meetingSeries, meetingDocuments, ruleDocuments, extractedRulesTable, feedbackLog, aiPreferences, summaryFeedback, summaryPreferences, wordCorrections, type VoiceProfile, type InsertVoiceProfile, type MeetingSession, type InsertMeetingSession, type MeetingSeriesRow, type InsertMeetingSeries, type MeetingDocument, type InsertMeetingDocument, type TranscriptSegment, type Question, type ExtractedRule, type UploadedDocument, type RulesState, type InsertRuleDocument, type InsertExtractedRule, type FeedbackLogEntry, type AiPreferences, type SummaryFeedbackEntry, type SummaryPreferences, type WordCorrection } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  getVoiceProfiles(): Promise<VoiceProfile[]>;
  getVoiceProfile(id: number): Promise<VoiceProfile | undefined>;
  createVoiceProfile(profile: InsertVoiceProfile): Promise<VoiceProfile>;
  deleteVoiceProfile(id: number): Promise<boolean>;
  
  // Meeting sessions
  getMeetingSessions(): Promise<MeetingSession[]>;
  getMeetingSession(id: number): Promise<MeetingSession | undefined>;
  createMeetingSession(session: InsertMeetingSession): Promise<MeetingSession>;
  updateMeetingSession(id: number, updates: Partial<InsertMeetingSession>): Promise<MeetingSession | undefined>;
  deleteMeetingSession(id: number): Promise<boolean>;

  // Meeting series
  getMeetingSeriesList(): Promise<MeetingSeriesRow[]>;
  getMeetingSeriesById(id: number): Promise<MeetingSeriesRow | undefined>;
  createMeetingSeries(series: InsertMeetingSeries): Promise<MeetingSeriesRow>;
  updateMeetingSeries(id: number, updates: Partial<InsertMeetingSeries>): Promise<MeetingSeriesRow | undefined>;
  updateSeriesNameOnSessions(seriesId: number, newName: string): Promise<void>;
  deleteMeetingSeries(id: number): Promise<boolean>;
  getSessionsInSeries(seriesId: number): Promise<MeetingSession[]>;
  
  // Meeting documents (knowledge docs scoped to session or series)
  getMeetingDocuments(sessionId?: number, seriesId?: number): Promise<MeetingDocument[]>;
  createMeetingDocument(doc: InsertMeetingDocument): Promise<MeetingDocument>;
  deleteMeetingDocument(id: number): Promise<boolean>;

  // Rules (persistent in database)
  getRulesState(): Promise<RulesState>;
  addDocument(document: InsertRuleDocument): Promise<number>;
  updateDocumentStatus(documentId: number, status: string, rulesExtracted?: number, errorMessage?: string): Promise<void>;
  addRules(rules: InsertExtractedRule[]): Promise<void>;
  clearRules(): Promise<void>;
  removeDocument(documentId: number): Promise<void>;

  // Learning / Feedback
  logFeedback(entry: { type: string; text: string; context?: string; accepted: boolean; expertRole?: string; source?: string }): Promise<void>;
  getFeedbackLog(): Promise<FeedbackLogEntry[]>;
  getAiPreferences(): Promise<AiPreferences | null>;
  setAiPreferences(profileText: string, signalCount: number): Promise<void>;
  logSummaryFeedback(commentText: string, summaryExcerpt?: string): Promise<void>;
  getSummaryFeedbackLog(): Promise<SummaryFeedbackEntry[]>;
  getSummaryPreferences(): Promise<SummaryPreferences | null>;
  setSummaryPreferences(profileText: string, feedbackCount: number): Promise<void>;

  // Word corrections (custom vocabulary for transcription)
  getWordCorrections(): Promise<WordCorrection[]>;
  upsertWordCorrection(original: string, corrected: string): Promise<WordCorrection>;
  deleteWordCorrection(id: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getVoiceProfiles(): Promise<VoiceProfile[]> {
    return await db.select().from(voiceProfiles);
  }

  async getVoiceProfile(id: number): Promise<VoiceProfile | undefined> {
    const [profile] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.id, id));
    return profile || undefined;
  }

  async createVoiceProfile(insertProfile: InsertVoiceProfile): Promise<VoiceProfile> {
    const [profile] = await db
      .insert(voiceProfiles)
      .values(insertProfile)
      .returning();
    return profile;
  }

  async deleteVoiceProfile(id: number): Promise<boolean> {
    const result = await db.delete(voiceProfiles).where(eq(voiceProfiles.id, id)).returning();
    return result.length > 0;
  }

  // Meeting sessions
  async getMeetingSessions(): Promise<MeetingSession[]> {
    return await db.select().from(meetingSessions).orderBy(desc(meetingSessions.startedAt));
  }

  async getMeetingSession(id: number): Promise<MeetingSession | undefined> {
    const [session] = await db.select().from(meetingSessions).where(eq(meetingSessions.id, id));
    return session || undefined;
  }

  async createMeetingSession(insertSession: InsertMeetingSession): Promise<MeetingSession> {
    const [session] = await db
      .insert(meetingSessions)
      .values([insertSession])
      .returning();
    return session;
  }

  async updateMeetingSession(id: number, updates: Record<string, unknown>): Promise<MeetingSession | undefined> {
    const [session] = await db
      .update(meetingSessions)
      .set(updates as any)
      .where(eq(meetingSessions.id, id))
      .returning();
    return session || undefined;
  }

  async deleteMeetingSession(id: number): Promise<boolean> {
    const result = await db.delete(meetingSessions).where(eq(meetingSessions.id, id)).returning();
    return result.length > 0;
  }

  // Meeting series
  async getMeetingSeriesList(): Promise<MeetingSeriesRow[]> {
    return await db.select().from(meetingSeries).orderBy(desc(meetingSeries.createdAt));
  }

  async getMeetingSeriesById(id: number): Promise<MeetingSeriesRow | undefined> {
    const [row] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, id));
    return row || undefined;
  }

  async createMeetingSeries(series: InsertMeetingSeries): Promise<MeetingSeriesRow> {
    const [row] = await db.insert(meetingSeries).values(series).returning();
    return row;
  }

  async updateMeetingSeries(id: number, updates: Partial<InsertMeetingSeries>): Promise<MeetingSeriesRow | undefined> {
    const [row] = await db.update(meetingSeries).set(updates).where(eq(meetingSeries.id, id)).returning();
    return row || undefined;
  }

  async updateSeriesNameOnSessions(seriesId: number, newName: string): Promise<void> {
    await db.update(meetingSessions)
      .set({ seriesName: newName })
      .where(eq(meetingSessions.seriesId, seriesId));
  }

  async deleteMeetingSeries(id: number): Promise<boolean> {
    // Unlink sessions first
    await db.update(meetingSessions).set({ seriesId: null }).where(eq(meetingSessions.seriesId, id));
    const result = await db.delete(meetingSeries).where(eq(meetingSeries.id, id)).returning();
    return result.length > 0;
  }

  async getSessionsInSeries(seriesId: number): Promise<MeetingSession[]> {
    return await db.select().from(meetingSessions)
      .where(eq(meetingSessions.seriesId, seriesId))
      .orderBy(meetingSessions.startedAt);
  }

  // Meeting documents
  async getMeetingDocuments(sessionId?: number, seriesId?: number): Promise<MeetingDocument[]> {
    const rows = await db.select().from(meetingDocuments).orderBy(desc(meetingDocuments.createdAt));
    return rows.filter(d => {
      if (sessionId && d.sessionId === sessionId) return true;
      if (seriesId && d.seriesId === seriesId) return true;
      if (!sessionId && !seriesId) return true;
      return false;
    });
  }

  async createMeetingDocument(doc: InsertMeetingDocument): Promise<MeetingDocument> {
    const [row] = await db.insert(meetingDocuments).values(doc).returning();
    return row;
  }

  async deleteMeetingDocument(id: number): Promise<boolean> {
    const result = await db.delete(meetingDocuments).where(eq(meetingDocuments.id, id)).returning();
    return result.length > 0;
  }

  // Rules management (persistent in database)
  async getRulesState(): Promise<RulesState> {
    const docs = await db.select().from(ruleDocuments).orderBy(desc(ruleDocuments.uploadedAt));
    const rules = await db.select().from(extractedRulesTable).orderBy(extractedRulesTable.createdAt);
    
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

  async addDocument(document: InsertRuleDocument): Promise<number> {
    const [doc] = await db.insert(ruleDocuments).values(document).returning();
    return doc.id;
  }

  async updateDocumentStatus(documentId: number, status: string, rulesExtracted?: number, errorMessage?: string): Promise<void> {
    const updates: Record<string, any> = { status };
    if (rulesExtracted !== undefined) updates.rulesExtracted = rulesExtracted;
    if (errorMessage !== undefined) updates.errorMessage = errorMessage;
    await db.update(ruleDocuments).set(updates).where(eq(ruleDocuments.id, documentId));
  }

  async addRules(rules: InsertExtractedRule[]): Promise<void> {
    if (rules.length > 0) await db.insert(extractedRulesTable).values(rules);
  }

  async clearRules(): Promise<void> {
    await db.delete(extractedRulesTable);
    await db.delete(ruleDocuments);
  }

  async removeDocument(documentId: number): Promise<void> {
    await db.delete(extractedRulesTable).where(eq(extractedRulesTable.documentId, documentId));
    await db.delete(ruleDocuments).where(eq(ruleDocuments.id, documentId));
  }

  // Learning / Feedback
  async logFeedback(entry: { type: string; text: string; context?: string; accepted: boolean; reason?: string; expertRole?: string; source?: string }): Promise<void> {
    await db.insert(feedbackLog).values({
      type: entry.type,
      text: entry.text,
      context: entry.context || null,
      accepted: entry.accepted,
      reason: entry.reason || null,
      expertRole: entry.expertRole || null,
      source: entry.source || "ai",
    });
  }

  async getFeedbackLog(): Promise<FeedbackLogEntry[]> {
    return await db.select().from(feedbackLog).orderBy(desc(feedbackLog.createdAt));
  }

  async getAiPreferences(): Promise<AiPreferences | null> {
    const [row] = await db.select().from(aiPreferences).where(eq(aiPreferences.id, 1));
    return row || null;
  }

  async setAiPreferences(profileText: string, signalCount: number): Promise<void> {
    const existing = await this.getAiPreferences();
    if (existing) {
      await db.update(aiPreferences).set({ profileText, signalCount, updatedAt: new Date() }).where(eq(aiPreferences.id, 1));
    } else {
      await db.insert(aiPreferences).values({ id: 1, profileText, signalCount });
    }
  }

  async logSummaryFeedback(commentText: string, summaryExcerpt?: string): Promise<void> {
    await db.insert(summaryFeedback).values({ commentText, summaryExcerpt: summaryExcerpt || null });
  }

  async getSummaryFeedbackLog(): Promise<SummaryFeedbackEntry[]> {
    return await db.select().from(summaryFeedback).orderBy(desc(summaryFeedback.createdAt));
  }

  async getSummaryPreferences(): Promise<SummaryPreferences | null> {
    const [row] = await db.select().from(summaryPreferences).where(eq(summaryPreferences.id, 1));
    return row || null;
  }

  async setSummaryPreferences(profileText: string, feedbackCount: number): Promise<void> {
    const existing = await this.getSummaryPreferences();
    if (existing) {
      await db.update(summaryPreferences).set({ profileText, feedbackCount, updatedAt: new Date() }).where(eq(summaryPreferences.id, 1));
    } else {
      await db.insert(summaryPreferences).values({ id: 1, profileText, feedbackCount });
    }
  }

  // Word corrections
  async getWordCorrections(): Promise<WordCorrection[]> {
    return await db.select().from(wordCorrections).orderBy(wordCorrections.createdAt);
  }

  async upsertWordCorrection(original: string, corrected: string): Promise<WordCorrection> {
    const [existing] = await db.select().from(wordCorrections).where(eq(wordCorrections.original, original));
    if (existing) {
      const [updated] = await db
        .update(wordCorrections)
        .set({ corrected })
        .where(eq(wordCorrections.id, existing.id))
        .returning();
      return updated;
    }
    const [row] = await db.insert(wordCorrections).values({ original, corrected }).returning();
    return row;
  }

  async deleteWordCorrection(id: number): Promise<boolean> {
    const result = await db.delete(wordCorrections).where(eq(wordCorrections.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
