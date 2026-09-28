// Shared option sets so profile values and the Discover filter always agree
// on the same vocabulary, instead of free text that can silently mismatch.
export const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
];

export const INTERESTED_IN_OPTIONS = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
  { value: 'non-binary people', label: 'Non-binary people' },
  { value: 'everyone', label: 'Everyone' },
];
