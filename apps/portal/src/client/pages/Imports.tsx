import type { ImportResult } from '@jsp/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, ErrorNote, Field, PageHeader, Select } from '../components/ui';
import { upload } from '../lib/api';
import { invalidateApplications } from '../lib/queries';

export function Imports() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState('auto');
  const run = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set('file', file);
      form.set('format', format);
      return upload<ImportResult>('/api/imports', form);
    },
    onSuccess: () => invalidateApplications(qc),
  });
  const result = run.data;
  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Bring in your LinkedIn application history or an existing tracker spreadsheet."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card title="Upload a CSV">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const file = fileRef.current?.files?.[0];
              if (file) run.mutate(file);
            }}
          >
            <Field label="CSV file" hint="Up to 2 MB. Save a spreadsheet as CSV first.">
              {(id) => (
                <input
                  id={id}
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,text/csv"
                  required
                  className="text-sm"
                />
              )}
            </Field>
            <Field label="Format">
              {(id) => (
                <Select
                  id={id}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="sm:w-64"
                >
                  <option value="auto">Detect automatically</option>
                  <option value="linkedin">LinkedIn data export</option>
                  <option value="generic">Tracker spreadsheet</option>
                </Select>
              )}
            </Field>
            <ErrorNote error={run.error} />
            <div>
              <Button type="submit" variant="primary" busy={run.isPending}>
                <Upload className="size-4" aria-hidden /> Import
              </Button>
            </div>
          </form>
          <div role="status">
            {result ? (
              <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 text-sm">
                <p className="text-ink">
                  <strong>{result.created}</strong> added · <strong>{result.updated}</strong>{' '}
                  updated · <strong>{result.skipped}</strong> already up to date
                </p>
                {result.errors.length > 0 ? (
                  <div>
                    <p className="font-medium text-ink">Rows that need attention</p>
                    <ul className="mt-1 list-disc pl-5 text-ink-2">
                      {result.errors.map((e) => (
                        <li key={`${e.row}-${e.message}`}>
                          {e.row > 0 ? `Row ${e.row}: ` : ''}
                          {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Link to="/applications" className="text-accent hover:underline">
                  See your applications →
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
        <Card title="Where to get the files">
          <div className="flex flex-col gap-3 text-sm text-ink-2">
            <p>
              <strong className="text-ink">LinkedIn:</strong> Settings → Data privacy → Get a copy
              of your data → Job applications. LinkedIn emails a ZIP; upload the “Job
              Applications.csv” inside (or each part if there are several).
            </p>
            <p>
              <strong className="text-ink">Spreadsheet:</strong> columns named like Company, Title
              or Position, Link, Date applied, Status and Notes are recognized (English or Chinese
              headers). Status words such as “Applied”, “Phone screen”, “Interviewing”, “Rejected”
              map to the pipeline.
            </p>
            <p>
              Re-importing is safe: rows already in the portal are matched by link, or by company
              and title, and only move forward.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
