import { Card } from '../components/Shell';
import { T } from '../texts';

export function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p className="text-muted">{T.soon}</p>
    </Card>
  );
}
