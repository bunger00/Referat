import { voiceProfiles, meetingSessions, meetingSeries, meetingDocuments, ruleDocuments, extractedRulesTable, feedbackLog, aiPreferences, summaryFeedback, summaryPreferences, wordCorrections, type VoiceProfile, type InsertVoiceProfile, type MeetingSession, type InsertMeetingSession, type MeetingSeriesRow, type InsertMeetingSeries, type MeetingDocument, type InsertMeetingDocument, type ExtractedRule, type UploadedDocument, type RulesState, type InsertRuleDocument, type InsertExtractedRule, type FeedbackLogEntry, type AiPreferences, type SummaryFeedbackEntry, type SummaryPreferences, type WordCorrection } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
