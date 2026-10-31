// Mounts the shared exam engine for the Exams and Assessments sections.
(() => {
  'use strict';

  const { ExamEngine, EXAM_BANK, ASSESSMENT_BANK } = window;
  if (!ExamEngine) return;

  if (EXAM_BANK) {
    const format = EXAM_BANK.examFormat;
    ExamEngine.mount(document.getElementById('view-exams'), EXAM_BANK, {
      storagePrefix: 'cca-f:exams',
      title: 'Practice Exams',
      lead: 'Timed exams in the official format. No question is invented: each one is copied word for word from the source linked under it.',
      stats: [
        `Real exam: ${format.items} questions`,
        `${format.minutes} minutes`,
        `${format.scenariosPerExam} of ${format.scenarioBank} scenarios`,
        `Pass: scaled ${format.passScaled} / 1000`,
      ],
      formatSource: format.source,
      passNote: `The real exam's pass mark is a scaled score of ${format.passScaled} on 100–1,000. The scaling formula is not public, so this percentage is not a scaled score.`,
    });
  }

  if (ASSESSMENT_BANK) {
    ExamEngine.mount(document.getElementById('view-assessments'), ASSESSMENT_BANK, {
      storagePrefix: 'cca-f:assessments',
      title: 'Assessments',
      lead: 'Three 30-question checkpoints from the course: before you start, halfway through the lectures, and before the practice exams. Questions, answers and explanations are copied from the course PDFs.',
      stats: ['30 questions each', '60 minutes', 'Starter · Midpoint · Final'],
      passNote: 'Any domain where you missed more than a third is the one to start with. (Course guidance from the assessment PDFs.)',
    });
  }
})();
