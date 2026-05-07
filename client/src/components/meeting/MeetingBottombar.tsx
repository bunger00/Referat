import { Brain, Timer, Mic2 } from "lucide-react";
import { RecordButton } from "@/components/ds";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExpertRole } from "@shared/schema";
import { expertRoleLabels } from "@shared/schema";

type Props = {
  isRecording: boolean;
  isStartingRecording?: boolean;
  onToggleRecording: () => void;

  expertRole: ExpertRole;
  onExpertRoleChange: (r: ExpertRole) => void;

  questionInterval: number;
  onQuestionIntervalChange: (n: number) => void;

  transcriptionModel: "medium" | "large" | "openai";
  onTranscriptionModelChange: (m: "medium" | "large" | "openai") => void;

  audioLevels: number[];
};

export function MeetingBottombar({
  isRecording,
  isStartingRecording,
  onToggleRecording,
  expertRole,
  onExpertRoleChange,
  questionInterval,
  onQuestionIntervalChange,
  transcriptionModel,
  onTranscriptionModelChange,
  audioLevels,
}: Props) {
  return (
    <footer className="shrink-0 border-t border-border bg-card/60 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <RecordButton
          recording={isRecording}
          loading={isStartingRecording}
          onClick={onToggleRecording}
        />

        {/* Audio level visualization */}
        <div
          className="hidden sm:flex items-end gap-[3px] h-10 w-32"
          aria-hidden
        >
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm bg-accent/60 transition-all duration-75"
              style={{
                height: isRecording ? `${Math.max(10, level * 100)}%` : "12%",
                opacity: isRecording ? 1 : 0.35,
              }}
            />
          ))}
        </div>

        <div className="flex-1" />

        {/* Settings */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 justify-end">
          <Select value={expertRole} onValueChange={(v) => onExpertRoleChange(v as ExpertRole)}>
            <SelectTrigger className="h-9 w-[140px] sm:w-[160px] text-xs gap-1.5 bg-background">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(expertRoleLabels) as ExpertRole[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {expertRoleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(questionInterval)}
            onValueChange={(v) => onQuestionIntervalChange(Number(v))}
          >
            <SelectTrigger className="h-9 w-[100px] sm:w-[120px] text-xs gap-1.5 bg-background">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Hvert min</SelectItem>
              <SelectItem value="5">Hvert 5. min</SelectItem>
              <SelectItem value="15">Hvert 15. min</SelectItem>
              <SelectItem value="0">Manuelt</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={transcriptionModel}
            onValueChange={(v) =>
              onTranscriptionModelChange(v as "medium" | "large" | "openai")
            }
          >
            <SelectTrigger className="hidden sm:inline-flex h-9 w-[140px] text-xs gap-1.5 bg-background">
              <Mic2 className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="medium">nb-whisper M</SelectItem>
              <SelectItem value="large">nb-whisper L</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </footer>
  );
}
