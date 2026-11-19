import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { ensureIndexes } from './ensureIndexes';
import { hashPassword } from '../lib/crypto';
import { Category, Course, CourseSection, Enrollment, Lesson } from '../models/course';
import { InstructorProfile, User } from '../models/identity';
import { Quiz } from '../models/learning';

const demoPassword = process.env.SKILLORA_DEMO_PASSWORD ?? 'SkilloraDev123!';

const categories = [
  { name: 'Creative practice', slug: 'creative-practice', icon: 'sparkles', order: 1 },
  { name: 'Technology', slug: 'technology', icon: 'code', order: 2 },
  { name: 'Writing & communication', slug: 'writing-communication', icon: 'pen-tool', order: 3 },
  { name: 'Wellbeing', slug: 'wellbeing', icon: 'sun', order: 4 },
];

const courses = [
  {
    title: 'A kinder kind of productivity',
    slug: 'kinder-kind-of-productivity',
    headline: 'Make a little more room for the things that matter.',
    description:
      'Build a sustainable way to plan your days, protect your energy, and make progress without burning out. A calm, practical class for finding a rhythm that feels like yours.',
    categorySlug: 'wellbeing',
    priceMinor: 0,
    level: 'beginner',
    objectives: ['Plan a week around the work that matters', 'Build a routine that leaves room to rest'],
    lessonTitles: ['Start with what matters', 'Make a kinder plan', 'A rhythm you can return to', 'A small weekly reset'],
  },
  {
    title: 'The art of visual storytelling',
    slug: 'art-of-visual-storytelling',
    headline: 'Find the story in every frame.',
    description:
      'Learn to notice the small details that make a photograph feel alive. Explore light, composition, and visual sequence with thoughtful prompts you can try anywhere.',
    categorySlug: 'creative-practice',
    priceMinor: 2400,
    level: 'beginner',
    objectives: ['Notice and shape natural light', 'Compose a connected set of images'],
    lessonTitles: ['Look a little closer', 'A frame with feeling', 'Finding light', 'Put the story together'],
  },
  {
    title: 'Build your first tiny website',
    slug: 'first-tiny-website',
    headline: 'A friendly first step into making things for the web.',
    description:
      'Create a small, personal website from the ground up. Learn the essentials of HTML and CSS while making something you can share with the world.',
    categorySlug: 'technology',
    priceMinor: 0,
    level: 'beginner',
    objectives: ['Structure a page with accessible HTML', 'Style a responsive layout with CSS'],
    lessonTitles: ['How the web fits together', 'Your first page', 'Make it feel like yours', 'Share your work'],
  },
  {
    title: 'Write with more confidence',
    slug: 'write-with-confidence',
    headline: 'Say what you mean, with a little more ease.',
    description:
      'A welcoming workshop on finding your voice, making a clear point, and revising your words with confidence. Bring a blank page and an open mind.',
    categorySlug: 'writing-communication',
    priceMinor: 1800,
    level: 'beginner',
    objectives: ['Find the heart of a piece of writing', 'Edit for clarity without losing your voice'],
    lessonTitles: ['Begin with a question', 'Make your point', 'Revise with intention', 'Share your words'],
  },
];

async function findOrCreateUser(
  input: { name: string; email: string; role: 'student' | 'instructor'; headline: string },
  passwordHash: string,
) {
  const user = await User.findOneAndUpdate(
    { email: input.email },
    {
      $setOnInsert: {
        name: input.name,
        email: input.email,
        role: input.role,
        headline: input.headline,
        passwordHash,
        isVerified: true,
        isActive: true,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return user;
}

async function main(): Promise<void> {
  if (env.NODE_ENV !== 'development') {
    throw new Error('Demo data can only be seeded when NODE_ENV=development.');
  }

  await connectDb();
  try {
    await ensureIndexes();

    const passwordHash = await hashPassword(demoPassword);
    const [learner, instructor] = await Promise.all([
      findOrCreateUser(
        { name: 'Alex Morgan', email: 'learner@skillora.local', role: 'student', headline: '' },
        passwordHash,
      ),
      findOrCreateUser(
        {
          name: 'Jordan Lee',
          email: 'instructor@skillora.local',
          role: 'instructor',
          headline: 'Teacher, maker, lifelong learner',
        },
        passwordHash,
      ),
    ]);

    const profile = await InstructorProfile.findOneAndUpdate(
      { user: instructor._id },
      {
        $setOnInsert: {
          user: instructor._id,
          displayName: instructor.name,
          headline: instructor.headline,
          expertise: ['Creative practice', 'Learning by doing'],
          approved: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const categoryBySlug = new Map<string, { _id: unknown }>();
    for (const category of categories) {
      const saved = await Category.findOneAndUpdate(
        { slug: category.slug },
        { $setOnInsert: category },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).select('_id').lean();
      categoryBySlug.set(category.slug, saved);
    }

    const courseBySlug = new Map<string, { _id: unknown }>();
    for (const item of courses) {
      const category = categoryBySlug.get(item.categorySlug);
      if (!category) throw new Error(`Missing category ${item.categorySlug}`);

      const course = await Course.findOneAndUpdate(
        { slug: item.slug },
        {
          $setOnInsert: {
            title: item.title,
            slug: item.slug,
            headline: item.headline,
            description: item.description,
            instructor: instructor._id,
            instructorProfile: profile._id,
            category: category._id,
            level: item.level,
            language: 'English',
            priceMinor: item.priceMinor,
            currency: 'USD',
            objectives: item.objectives,
            prerequisites: [],
            status: 'published',
            publishedAt: new Date(),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).select('_id').lean();
      courseBySlug.set(item.slug, course);

      const section = await CourseSection.findOneAndUpdate(
        { course: course._id, title: 'The class' },
        { $setOnInsert: { course: course._id, title: 'The class', order: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).select('_id').lean();

      const lessonIds: unknown[] = [];
      for (let index = 0; index < item.lessonTitles.length; index += 1) {
        const title = item.lessonTitles[index];
        const lesson = await Lesson.findOneAndUpdate(
          { course: course._id, section: section._id, title },
          {
            $setOnInsert: {
              course: course._id,
              section: section._id,
              title,
              type: index === item.lessonTitles.length - 1 ? 'quiz' : 'text',
              order: index,
              durationSeconds: index === item.lessonTitles.length - 1 ? 0 : 360,
              isPublished: true,
              isPreview: index === 0,
              content: `Take a moment with “${title}”. Try the idea in your own way, and notice what you discover.`,
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).select('_id type').lean();
        lessonIds.push(lesson._id);

        if (lesson.type === 'quiz') {
          await Quiz.findOneAndUpdate(
            { course: course._id, lesson: lesson._id },
            {
              $setOnInsert: {
                course: course._id,
                lesson: lesson._id,
                title: `A quick reflection: ${item.title}`,
                description: 'A couple of gentle questions to help the ideas stick.',
                passScorePercent: 50,
                timeLimitSeconds: null,
                maxAttempts: 3,
                questions: [
                  {
                    id: 'q1',
                    type: 'single_choice',
                    prompt: 'What is the best way to learn a new idea?',
                    points: 1,
                    options: [
                      { id: 'a', text: 'Try it in a way that feels useful to you' },
                      { id: 'b', text: 'Wait until everything feels perfect' },
                    ],
                    correctOptionIds: ['a'],
                    explanation: 'A small experiment is a lovely place to begin.',
                  },
                  {
                    id: 'q2',
                    type: 'multi_choice',
                    prompt: 'Which of these can help a new habit stick?',
                    points: 1,
                    options: [
                      { id: 'a', text: 'Making the first step manageable' },
                      { id: 'b', text: 'Giving yourself room to practice' },
                      { id: 'c', text: 'Expecting perfection on day one' },
                    ],
                    correctOptionIds: ['a', 'b'],
                    explanation: 'A kind, repeatable start beats perfection.',
                  },
                ],
                totalPoints: 2,
                isActive: true,
              },
            },
            { upsert: true, setDefaultsOnInsert: true },
          );
        }
      }

      await Course.updateOne(
        { _id: course._id },
        {
          $set: {
            sectionCount: 1,
            lessonCount: lessonIds.length,
            totalDurationSeconds: (item.lessonTitles.length - 1) * 360,
          },
        },
      );
    }

    const freeCourse = courseBySlug.get('kinder-kind-of-productivity');
    if (!freeCourse) throw new Error('Missing free sample course.');
    const totalLessons = await Lesson.countDocuments({ course: freeCourse._id, isPublished: true });
    await Enrollment.findOneAndUpdate(
      { user: learner._id, course: freeCourse._id },
      {
        $setOnInsert: {
          user: learner._id,
          course: freeCourse._id,
          source: 'seed',
          totalLessons,
          lastAccessedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    await Course.updateOne(
      { _id: freeCourse._id },
      { $set: { enrollmentCount: await Enrollment.countDocuments({ course: freeCourse._id }) } },
    );

    console.info('Skillora development data is ready.');
    console.info(`Learner:    learner@skillora.local`);
    console.info(`Instructor: instructor@skillora.local`);
    console.info('Password:   SKILLORA_DEMO_PASSWORD or the local development default');
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error('Unable to seed Skillora development data.', error);
  process.exitCode = 1;
});
