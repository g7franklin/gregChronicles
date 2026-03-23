'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

type AttachmentFile = { file: File; id: string; preview?: string };
type UploadedAttachment = {
  attachmentId: string;
  gcsPath: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  type: 'audio' | 'video' | 'image';
};

function getAttachmentType(file: File): 'audio' | 'video' | 'image' {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'image';
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DaysState = Record<DayKey, boolean>;

const DEFAULT_DAYS: DaysState = {
  mon: false,
  tue: false,
  wed: false,
  thu: false,
  fri: false,
  sat: false,
  sun: false,
};

const DAY_ORDER: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

function getTodayKey(now: Date): DayKey {
  // JS: getDay() => 0 (Sun) ... 6 (Sat)
  const d = now.getDay();
  return d === 0 ? 'sun' : (['mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d - 1] as DayKey);
}

export default function CapturePage() {
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [trackerWeekKey, setTrackerWeekKey] = useState<string | null>(null);
  const [trackerDays, setTrackerDays] = useState<DaysState>({ ...DEFAULT_DAYS });
  const [trackerLoading, setTrackerLoading] = useState(true);
  const [trackerSaving, setTrackerSaving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.preview) URL.revokeObjectURL(a.preview);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTrackerLoading(true);
    apiGet<{ weekKey: string; days: DaysState }>('/admin/capture-tracker/current')
      .then((r) => {
        if (cancelled) return;
        setTrackerWeekKey(r.weekKey);
        setTrackerDays(r.days);
      })
      .catch(() => {
        if (cancelled) return;
        setTrackerWeekKey(null);
        setTrackerDays({ ...DEFAULT_DAYS });
      })
      .finally(() => {
        if (cancelled) return;
        setTrackerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      if (recognitionRef.current && typeof (recognitionRef.current as { stop: () => void }).stop === 'function') {
        (recognitionRef.current as { stop: () => void }).stop();
      }
      setRecording(false);
      return;
    }

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec: any = new SpeechRecognition();
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
  }, [recording]);

  const clearAll = useCallback(() => {
    setTranscript('');
    setRecordedBlob(null);
    attachments.forEach((a) => {
      if (a.preview) URL.revokeObjectURL(a.preview);
    });
    setAttachments([]);
    setMessage(null);
  }, [attachments]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const newAttachments: AttachmentFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
        const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
        newAttachments.push({ file: f, id: Math.random().toString(36).slice(2), preview });
      }
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const item = prev.find((a) => a.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((a) => a.id !== id);
    });
  };

  const submit = async () => {
    setSubmitting(true);
    setUploadProgress(null);
    setMessage(null);
    try {
      // Collect all files: recorded audio first, then photo/video attachments
      const filesToUpload: File[] = [];
      if (recordedBlob) {
        filesToUpload.push(new File([recordedBlob], 'recording.webm', { type: 'audio/webm' }));
      }
      for (const a of attachments) {
        filesToUpload.push(a.file);
      }

      let memoIdForSave: string | undefined;
      const uploadedAttachments: UploadedAttachment[] = [];

      if (filesToUpload.length > 0) {
        // Step 1: Ask the API for a signed GCS upload URL for each file
        const result = await apiPost('/admin/memos/upload-urls', {
          files: filesToUpload.map((f) => ({
            filename: f.name,
            contentType: f.type || 'application/octet-stream',
            size: f.size,
          })),
        }) as { memoId: string; uploads: Array<{ attachmentId: string; gcsPath: string; uploadUrl: string }> };

        memoIdForSave = result.memoId;

        // Step 2: Upload each file directly to GCS — API server never touches the bytes
        for (let i = 0; i < filesToUpload.length; i++) {
          setUploadProgress({ current: i + 1, total: filesToUpload.length });
          const file = filesToUpload[i];
          const { attachmentId, gcsPath, uploadUrl } = result.uploads[i];
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (!uploadRes.ok) throw new Error(`Upload failed for ${file.name} (${uploadRes.status})`);
          uploadedAttachments.push({
            attachmentId,
            gcsPath,
            originalName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            type: getAttachmentType(file),
          });
        }
      }

      // Step 3: Save the memo record (just metadata — no file bytes)
      await apiPost('/admin/memos', {
        ...(memoIdForSave ? { memoId: memoIdForSave } : {}),
        transcript,
        attachments: uploadedAttachments,
      });

      setMessage({ text: 'Saved!', ok: true });

      // Mark "today" in the weekly tracker
      const todayKey = getTodayKey(new Date());
      const nextDays: DaysState = { ...trackerDays, [todayKey]: true };
      setTrackerDays(nextDays);
      try {
        await apiPatch('/admin/capture-tracker/current', { days: nextDays });
      } catch {
        // tracker failing doesn't affect the memo
      }

      clearAll();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-lg px-4 py-2 flex flex-col gap-4 min-h-[calc(100dvh-56px)]">
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={3}
          className="w-full min-h-[80px] resize-none border border-slate-300 rounded-xl p-3 text-base
                     focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent
                     placeholder:text-slate-400"
          placeholder="What's on your mind?"
        />

        <div className="flex flex-col items-center gap-2">
          <button
            onClick={toggleRecording}
            className={`flex items-center justify-center w-20 h-20 rounded-full shrink-0 transition-all
              ${recording
                ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:bg-slate-300'
              }`}
            aria-label={recording ? 'Stop recording' : 'Start voice recording'}
          >
            {recording ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2Z" />
              </svg>
            )}
          </button>
          <span className={`text-sm font-medium ${recording ? 'text-red-500' : 'text-slate-400'}`}>
            {recording ? 'Listening...' : 'Tap to record'}
          </span>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif,video/mp4,video/quicktime,video/webm"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          {attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-3">
              {attachments.map((a) => (
                <div key={a.id} className="relative group w-20 h-20 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                  {a.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview} alt={a.file.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                        <path d="M4 4h16v16H4V4Zm2 2v8l3-3 2 2 4-4 3 3V6H6Z" />
                      </svg>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white
                               flex items-center justify-center text-xs leading-none"
                    aria-label={`Remove ${a.file.name}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300
                       rounded-xl text-slate-500 text-sm hover:border-slate-400 hover:text-slate-600
                       active:bg-slate-50 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4h2v4h14v-4h2ZM12 3l-5 5h3v6h4V8h3l-5-5Z" />
            </svg>
            Add photos or videos
          </button>
        </div>

        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-slate-800">This week - update days</h2>
            {trackerWeekKey && <span className="text-xs text-slate-500">{trackerWeekKey}</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DAY_ORDER.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700 select-none">
                <input
                  type="checkbox"
                  checked={trackerDays[key]}
                  disabled={trackerLoading || trackerSaving}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    const prevChecked = trackerDays[key];
                    const nextDays: DaysState = { ...trackerDays, [key]: checked };
                    setTrackerDays(nextDays);
                    setTrackerSaving(true);
                    try {
                      await apiPatch('/admin/capture-tracker/current', { days: nextDays });
                    } catch (err) {
                      setMessage({
                        text: err instanceof Error ? err.message : String(err),
                        ok: false,
                      });
                      // Roll back on failure so UI doesn't lie.
                      setTrackerDays((prev) => ({ ...prev, [key]: prevChecked }));
                    } finally {
                      setTrackerSaving(false);
                    }
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">Boxes reset automatically at the start of each week.</p>
        </div>

        <div className="flex gap-3 pb-4">
          <button
            onClick={submit}
            disabled={submitting || (!transcript.trim() && attachments.length === 0)}
            className="flex-1 py-3 bg-slate-800 text-white rounded-xl text-base font-medium
                       disabled:opacity-40 active:bg-slate-900 transition-colors"
          >
            {submitting
              ? uploadProgress
                ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…`
                : 'Saving…'
              : 'Save'}
          </button>
          {(transcript || attachments.length > 0 || recordedBlob) && (
            <button
              onClick={clearAll}
              className="px-4 py-3 bg-slate-100 text-slate-600 rounded-xl text-base
                         hover:bg-slate-200 active:bg-slate-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {message && (
          <p className={`text-sm text-center -mt-2 ${message.ok ? 'text-green-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </AdminLayout>
  );
}
