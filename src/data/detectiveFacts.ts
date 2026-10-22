export type DetectiveFact = Readonly<{
  id: string;
  spokenText: string;
  sourceUrls: readonly string[];
}>;

// Verified against Project Gutenberg's author/title metadata and contents list,
// not its automatically generated book summaries. These sources are attribution
// only: no network access is needed to select, validate, or speak a fact.
export const detectiveFacts: readonly DetectiveFact[] = Object.freeze([
  Object.freeze({
    id: 'scarlet-author',
    spokenText: 'Arthur Conan Doyle wrote A Study in Scarlet. Even a fictional detective needs an author on the case.',
    sourceUrls: Object.freeze(['https://www.gutenberg.org/ebooks/244']),
  }),
  Object.freeze({
    id: 'twelve-adventures',
    spokenText: 'The Adventures of Sherlock Holmes contains twelve stories by Arthur Conan Doyle. Apparently a quiet week was too much to ask.',
    sourceUrls: Object.freeze(['https://www.gutenberg.org/ebooks/1661']),
  }),
  Object.freeze({
    id: 'blue-carbuncle',
    spokenText: 'The Adventure of the Blue Carbuncle is a story in The Adventures of Sherlock Holmes. Even the titles seem to be keeping secrets.',
    sourceUrls: Object.freeze(['https://www.gutenberg.org/ebooks/1661']),
  }),
]);

export function getDetectiveFact(id: string): DetectiveFact | undefined {
  return detectiveFacts.find((fact) => fact.id === id);
}
