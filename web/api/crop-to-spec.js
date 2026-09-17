// Deprecated: replaced by crop-to-spec/[filename].js so the filename lives in
// the URL path (fixes browsers guessing a random name / wrong extension on
// "Save Image As"). Nothing calls this route anymore. Left in place - and
// still functional as a fallback - because this OneDrive folder blocks file
// deletion for this session's tools.
export { default } from './crop-to-spec/[filename].js';
