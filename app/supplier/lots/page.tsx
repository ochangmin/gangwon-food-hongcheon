import { requireProfile } from '@/lib/session';
import { qty, STORAGE } from '@/lib/format';
import { PageHead, Empty } from '@/components/ui';

type Lot = { id: string; lot_no: string; received_date: string; received_qty: number; storage: string; cert_type: string | null; items: { name: string; unit: string } };

export default async function SupplierLots() {
  const { sb, p } = await requireProfile(['supplier']);
  const { data } = await sb.from('lots').select('id,lot_no,received_date,received_qty,storage,cert_type,items(name,unit)').order('received_date', { ascending: false }).limit(200);
  const lots = (data ?? []) as unknown as Lot[];
  return (
    <>
      <PageHead crumb={p.suppliers?.name ?? '공급업체'} title="입고·로트 이력" desc="센터에 입고된 우리 업체 품목과 부여된 로트번호입니다. 클레임 문의 시 로트번호로 확인하세요." />
      <section className="panel">
        {!lots.length ? <Empty>입고 이력이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>로트번호</th><th>입고일</th><th>품목</th><th className="n">입고수량</th><th>보관</th><th>인증</th></tr></thead>
            <tbody>{lots.map((l) => (
              <tr key={l.id}><td className="mono">{l.lot_no}</td><td>{l.received_date}</td><td>{l.items.name}</td><td className="n">{qty(l.received_qty)} {l.items.unit}</td><td>{STORAGE[l.storage]}</td><td>{l.cert_type}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
