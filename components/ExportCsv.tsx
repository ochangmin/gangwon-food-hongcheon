'use client';

/** 화면의 표를 엑셀에서 열리는 CSV로 내려받기 (umji의 엑셀 버튼 대응) */
export function ExportCsv({ target, name }: { target: string; name: string }) {
  const run = () => {
    const box = document.getElementById(target);
    const table = box?.querySelector('table');
    if (!table) return;
    const rows = [...table.querySelectorAll('tr')].map((tr) =>
      [...tr.querySelectorAll('th,td')]
        .filter((c) => !c.classList.contains('noexport'))
        .map((c) => {
          const input = c.querySelector('input:not([type=checkbox]),select') as HTMLInputElement | HTMLSelectElement | null;
          const v = (input ? input.value : (c as HTMLElement).innerText).replace(/\s+/g, ' ').trim();
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    );
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return <button type="button" className="btn" onClick={run}>엑셀</button>;
}
