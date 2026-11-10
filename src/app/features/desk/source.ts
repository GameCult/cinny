import { ForkList } from './forkContract';

type DeskSource = (mind: string) => ForkList | undefined;

// Slice 1 reads no network. The preview demo installs seeded forks here; slice 2 replaces this with
// Bifrost's list reader, which is why the page asks a function and not a fixture.
let source: DeskSource = () => undefined;

export const setDeskSource = (next: DeskSource) => {
  source = next;
};

export const deskFor = (mind: string): ForkList | undefined => source(mind);
