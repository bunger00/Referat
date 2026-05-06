import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { useEffect, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Undo,
  Redo,
  Minus,
} from "lucide-react";

marked.setOptions({ gfm: true, breaks: false });

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
turndown.use(gfm);

export interface SummaryWysiwygEditorRef {
  getMarkdown: () => string;
}

interface Props {
  initialMarkdown: string;
}

const SummaryWysiwygEditor = forwardRef<SummaryWysiwygEditorRef, Props>(({ initialMarkdown }, ref) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: marked.parse(initialMarkdown) as string,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[400px] p-1",
      },
    },
  });

  useEffect(() => {
    if (editor && initialMarkdown) {
      const html = marked.parse(initialMarkdown) as string;
      editor.commands.setContent(html, false);
    }
  }, [initialMarkdown]);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => {
      if (!editor) return "";
      return turndown.turndown(editor.getHTML());
    },
  }));

  if (!editor) return null;

  const ToolbarButton = ({
    onClick,
    active,
    disabled,
    children,
    title,
  }: {
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="h-7 w-7 p-0"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  );

  return (
    <div className="flex flex-col h-full border rounded-md overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/40 shrink-0">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Fet"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Kursiv"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Overskrift 1"
        >
          <Heading1 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Overskrift 2"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Overskrift 3"
        >
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Punktliste"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Nummerert liste"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Skillelinje"
        >
          <Minus className="h-3.5 w-3.5" />
        </ToolbarButton>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Angre"
        >
          <Undo className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Gjenta"
        >
          <Redo className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <style>{`
          .tiptap-editor .prose h1 { font-size: 1.5rem; font-weight: 700; margin: 0.75rem 0 0.5rem; border-bottom: 2px solid hsl(var(--border)); padding-bottom: 0.25rem; }
          .tiptap-editor .prose h2 { font-size: 1.2rem; font-weight: 600; margin: 1.25rem 0 0.5rem; border-bottom: 1px solid hsl(var(--border)); padding-bottom: 0.2rem; }
          .tiptap-editor .prose h3 { font-size: 1.05rem; font-weight: 600; margin: 1rem 0 0.4rem; }
          .tiptap-editor .prose p { margin: 0.4rem 0; line-height: 1.65; }
          .tiptap-editor .prose ul { list-style-type: disc; padding-left: 1.25rem; margin: 0.4rem 0; }
          .tiptap-editor .prose ol { list-style-type: decimal; padding-left: 1.25rem; margin: 0.4rem 0; }
          .tiptap-editor .prose li { margin: 0.2rem 0; }
          .tiptap-editor .prose strong { font-weight: 700; }
          .tiptap-editor .prose em { font-style: italic; }
          .tiptap-editor .prose table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.875rem; }
          .tiptap-editor .prose th { background: hsl(var(--muted)); font-weight: 600; text-align: left; padding: 0.4rem 0.75rem; border: 1px solid hsl(var(--border)); }
          .tiptap-editor .prose td { padding: 0.35rem 0.75rem; border: 1px solid hsl(var(--border)); vertical-align: top; }
          .tiptap-editor .prose hr { border: none; border-top: 1px solid hsl(var(--border)); margin: 1rem 0; }
          .tiptap-editor .prose blockquote { border-left: 3px solid hsl(var(--border)); margin: 0.5rem 0; padding: 0.25rem 0.75rem; color: hsl(var(--muted-foreground)); }
          .tiptap-editor [contenteditable]:focus { outline: none; }
          .tiptap-editor .ProseMirror-selectednode { outline: 2px solid hsl(var(--ring)); }
          .tiptap-editor .selectedCell { background: hsl(var(--muted)/0.5) !important; }
        `}</style>
        <div className="tiptap-editor">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});

SummaryWysiwygEditor.displayName = "SummaryWysiwygEditor";

export default SummaryWysiwygEditor;
