'use client';

import { useState, useRef, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiPostFormData } from '@/lib/api';

type AttachmentFile = { file: File; id: string };

export default function CapturePage() {
  const [transcript, setTranscript] = useState('');
  const [title, setTitle] = useState('');
  const [attachmentSummary, setAttachmentSummary] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<unknown>(null);

  const startRecording = useCallback(() => {
    if (typeof window === 'undefined') return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        if (chunksRef.current.length) {
          setRecordedBlob(new Blob(chunksRef.current, { type: 'audio/webm' }));
        }
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    });
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e: { results: Iterable<{ isFinal: boolean; [key: number]: { transcript: string } }> }) => {
          const last = Array.from(e.results).pop();
          if (last?.isFinal) {
            setTranscript((t) => t + (last[0]?.transcript ?? '') + ' ');
          }
        };
        rec.start();
        recognitionRef.current = rec;
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (recognitionRef.current && typeof (recognitionRef.current as { stop: () => void }).stop === 'function') {
      (recognitionRef.current as { stop: () => void }).stop();
    }
    setRecording(false);
  }, []);

  const playBack = useCallback(() => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = new Audio(url);
    a.play();
    a.onended = () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  const clearAll = useCallback(() => {
    setTranscript('');
    setTitle('');
    setAttachmentSummary('');
    setRecordedBlob(null);
    setAttachments([]);
    setMessage(null);
  }, []);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/')) {
        setAttachments((prev) => [...prev, { file: f, id: Math.random().toString(36).slice(2) }]);
      }
    }
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const submit = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('transcript', transcript);
      if (title) form.append('title', title);
      if (attachmentSummary) form.append('attachmentSummary', attachmentSummary);
      if (recordedBlob) {
        form.append('recordedAudio', recordedBlob, 'recording.webm');
      }
      attachments.forEach((a) => {
        form.append('attachments', a.file, a.file.name);
      });
      await apiPostFormData('/admin/memos', form);
      setMessage('Memo saved.');
      clearAll();
    } catch (e) {
      setMessage('Error: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-4">Capture</h1>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Transcript (live + editable)</label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={8}
              className="w-full border border-slate-300 rounded-lg p-2"
              placeholder="Start recording for speech-to-text or type here..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2"
              placeholder="Short title"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startRecording}
              disabled={recording}
              className="px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-50"
            >
              Start Recording
            </button>
            <button
              onClick={stopRecording}
              disabled={!recording}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg disabled:opacity-50"
            >
              Stop
            </button>
            <button
              onClick={playBack}
              disabled={!recordedBlob}
              className="px-4 py-2 bg-slate-500 text-white rounded-lg disabled:opacity-50"
            >
              Play Back
            </button>
            <button onClick={clearAll} className="px-4 py-2 bg-slate-400 text-white rounded-lg">
              Clear
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Attach audio/video (optional)</label>
            <div
              className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center text-slate-500"
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-slate-50'); }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('bg-slate-50'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('bg-slate-50');
                addFiles(e.dataTransfer.files);
              }}
            >
              <p className="mb-2">Drag and drop audio/video here, or click to select</p>
              <input
                type="file"
                accept="image/*,.heic,.heif,audio/*,video/mp4,video/quicktime,video/webm"
                multiple
                className="hidden"
                id="file-upload"
                onChange={(e) => addFiles(e.target.files)}
              />
              <label htmlFor="file-upload" className="cursor-pointer text-sky-600 hover:underline">
                Choose files
              </label>
            </div>
            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between bg-slate-100 rounded px-2 py-1">
                    <span className="text-sm">{a.file.name} ({a.file.type}, {(a.file.size / 1024).toFixed(1)} KB)</span>
                    <button type="button" onClick={() => removeAttachment(a.id)} className="text-red-600 text-sm">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Attachment summary (optional)</label>
            <input
              type="text"
              value={attachmentSummary}
              onChange={(e) => setAttachmentSummary(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2"
              placeholder="e.g. video: ski trip clip, audio: guitar riff"
            />
          </div>
          <button
            onClick={submit}
            disabled={submitting || !transcript.trim()}
            className="px-6 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          {message && <p className="text-sm text-slate-600">{message}</p>}
        </div>
      </div>
    </AdminLayout>
  );
}
