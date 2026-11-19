import { useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Clock3,
  GraduationCap,
  Layers3,
  LockKeyhole,
  LogOut,
  Menu,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react';
import Hls from 'hls.js';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useAuth } from './lib/auth';
import {
  api,
  type Category,
  formatDuration,
  formatPrice,
  type Course,
  type CourseDetail,
  type Enrollment,
  type Lesson,
  type LessonPlayer,
  type Page,
  type QuizSession,
} from './lib/api';

function App() {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <main className="boot-screen" aria-label="Loading Skillora">
        <span className="brand-mark"><GraduationCap size={22} /></span>
        <span className="loading-dot" />
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/courses" element={<CatalogPage />} />
        <Route path="/courses/:slug" element={<CoursePage />} />
        <Route path="/learn" element={<LearningPage />} />
        <Route path="/learn/:courseId" element={<PlayerPage />} />
        <Route path="/teach" element={<InstructorPage />} />
        <Route path="/teach/courses/:courseId" element={<CourseEditorPage />} />
        <Route path="/checkout/:reference" element={<CheckoutPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/payment/success" element={<PaymentNotice />} />
        <Route path="/payment/cancelled" element={<PaymentNotice cancelled />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Footer />
    </div>
  );
}

function Header() {
  const { user, signOut, sessionError } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [signOutError, setSignOutError] = useState('');
  const searchInput = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    navigate(query ? `/courses?q=${encodeURIComponent(query)}` : '/courses');
    setMobileOpen(false);
  };

  const leave = async () => {
    setSignOutError('');
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" to="/" aria-label="Skillora home">
          <span className="brand-mark"><GraduationCap size={22} strokeWidth={2.2} /></span>
          <span>skillora<span className="brand-period">.</span></span>
        </Link>
        <button
          className="icon-button mobile-menu-button"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`main-nav ${mobileOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <Link to="/courses" onClick={() => setMobileOpen(false)}>Explore</Link>
          {user && (
            <Link to="/learn" onClick={() => setMobileOpen(false)}>My learning</Link>
          )}
          {user && (user.role === 'instructor' || user.role === 'admin') && (
            <Link to="/teach" onClick={() => setMobileOpen(false)}>Teach</Link>
          )}
          <form className="header-search" onSubmit={search} role="search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInput}
              aria-label="Search courses"
              placeholder="What do you want to learn?"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <button type="submit" className="visually-hidden">Search</button>
            <kbd>Ctrl K</kbd>
          </form>
          {user ? (
            <div className="header-account">
              <span className="avatar">{initials(user.name)}</span>
              <span className="header-name">{user.name.split(' ')[0]}</span>
              <button className="icon-button logout-button" onClick={() => void leave()} aria-label="Sign out">
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <div className="header-actions">
              <Link className="sign-in-link" to="/login" onClick={() => setMobileOpen(false)}>Log in</Link>
              <Link className="button button-dark button-small" to="/register" onClick={() => setMobileOpen(false)}>
                Get started <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </nav>
      </div>
      {(signOutError || sessionError) && (
        <div className="header-error" role="alert">
          {signOutError || `Your session could not be restored: ${sessionError}`}
        </div>
      )}
    </header>
  );
}

function HomePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseError, setCourseError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Page<Course>>('/courses?limit=4&sort=popular', { auth: false })
      .then((page) => setCourses(page.items))
      .catch((error: unknown) => setCourseError(messageFor(error)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> YOUR NEXT CHAPTER STARTS HERE</div>
            <h1>Make room for<br />what <span className="serif-accent">moves you.</span></h1>
            <p className="hero-description">
              Expert-led classes for the curious, the ambitious, and everyone becoming a little more themselves.
            </p>
            <div className="hero-actions">
              <Link className="button button-dark" to="/courses">
                Explore courses <ArrowRight size={17} />
              </Link>
              <Link className="text-link" to="/register">Teach on Skillora <ArrowDownRight size={16} /></Link>
            </div>
            <div className="hero-proof">
              <span><strong>Curiosity looks good on you.</strong> Start wherever you are.</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Learning is a journey">
            <div className="art-sun" />
            <div className="art-outline art-outline-one" />
            <div className="art-outline art-outline-two" />
            <div className="art-block art-block-orange" />
            <div className="art-block art-block-lilac" />
            <div className="art-plant"><span /><span /><span /></div>
            <div className="art-stair art-stair-one" />
            <div className="art-stair art-stair-two" />
            <div className="art-stair art-stair-three" />
            <div className="art-card">
              <span className="art-card-icon"><Sparkles size={17} /></span>
              <span className="art-card-label">A little progress</span>
              <strong>Every day counts.</strong>
              <div className="art-progress"><span /></div>
              <span className="art-progress-note">4 days in a row <span>↗</span></span>
            </div>
            <span className="art-note art-note-top">Stay curious <Sparkles size={13} /></span>
            <span className="art-note art-note-bottom">Your pace, your path.</span>
          </div>
        </div>
        <div className="hero-bottom">
          <span>GOOD THINGS GROW HERE</span>
          <span className="hero-bottom-line" />
          <span>01 — 04</span>
        </div>
      </section>

      <section className="trust-strip" aria-label="Platform highlights">
        <div><Users size={19} /><span><strong>Expert instructors</strong><small>Learn from people who do</small></span></div>
        <div><Layers3 size={19} /><span><strong>Learn by doing</strong><small>Skills you can put to work</small></span></div>
        <div><Award size={19} /><span><strong>Progress that counts</strong><small>Celebrate every milestone</small></span></div>
        <div><ShieldCheck size={19} /><span><strong>Learn for life</strong><small>Come back whenever you like</small></span></div>
      </section>

      <section className="section-wrap featured-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow eyebrow-muted">A GOOD PLACE TO BEGIN</div>
            <h2>Popular right now<span className="heading-period">.</span></h2>
          </div>
          <Link className="text-link" to="/courses">Browse all courses <ArrowRight size={16} /></Link>
        </div>
        {courseError ? (
          <ErrorNotice message={courseError} />
        ) : loading ? (
          <CourseGridSkeleton />
        ) : courses.length ? (
          <CourseGrid courses={courses} />
        ) : (
          <EmptyNotice title="Your next favorite class is on its way." message="Check back soon or browse our full catalog." />
        )}
      </section>

      <section className="callout-wrap">
        <div className="callout">
          <div>
            <div className="eyebrow eyebrow-light">MADE FOR THE WAY YOU LEARN</div>
            <h2>Small steps.<br /><span className="serif-accent">Big becoming.</span></h2>
            <p>Pick up a new skill, find your people, and see what you’re capable of.</p>
            <Link className="button button-light" to="/courses">Find your first class <ArrowRight size={16} /></Link>
          </div>
          <div className="callout-art">
            <div className="callout-sun" />
            <div className="callout-circles" />
            <div className="callout-book"><BookOpen size={45} /></div>
            <span className="callout-sparkle callout-sparkle-one">✳</span>
            <span className="callout-sparkle callout-sparkle-two">✳</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [level, setLevel] = useState(searchParams.get('level') ?? '');
  const [price, setPrice] = useState(searchParams.get('price') ?? '');
  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [sort, setSort] = useState(searchParams.get('sort') ?? 'popular');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const submittedQuery = searchParams.get('q') ?? '';

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
    setSort(searchParams.get('sort') ?? 'popular');
  }, [searchParams]);

  useEffect(() => {
    api<Category[]>('/categories', { auth: false })
      .then(setCategories)
      .catch((cause: unknown) => setError(messageFor(cause)));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: '1', limit: '12', sort });
    if (submittedQuery) params.set('q', submittedQuery);
    if (level) params.set('level', level);
    if (price) params.set('price', price);
    if (category) params.set('category', category);
    setLoading(true);
    setError('');
    api<Page<Course>>(`/courses?${params}`, { auth: false })
      .then((page) => {
        setCourses(page.items);
        setTotal(page.total);
      })
      .catch((cause: unknown) => setError(messageFor(cause)))
      .finally(() => setLoading(false));
  }, [submittedQuery, level, price, category, sort]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set('q', query.trim());
    else next.delete('q');
    setSearchParams(next);
  };

  const clearFilters = () => {
    setLevel('');
    setPrice('');
    setCategory('');
    setQuery('');
    setSearchParams({});
  };

  return (
    <main className="catalog-page">
      <section className="catalog-intro">
        <div className="eyebrow eyebrow-muted">A WORLD OF POSSIBILITY</div>
        <h1>Find your next <span className="serif-accent">thing.</span></h1>
        <p>Practical classes. Generous teachers. Skills that stick with you.</p>
        <form className="catalog-search" onSubmit={submitSearch}>
          <Search size={19} />
          <input
            aria-label="Search all courses"
            placeholder="Try “design”, “photography” or “coding”"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="button button-dark button-small">Search</button>
        </form>
      </section>

      <section className="catalog-content">
        <aside className="filter-panel">
          <div className="filter-heading">Refine your search</div>
          <label className="filter-label" htmlFor="level">Experience level</label>
          <select id="level" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <label className="filter-label" htmlFor="price">Price</label>
          <select id="price" value={price} onChange={(event) => setPrice(event.target.value)}>
            <option value="">Any price</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
          <label className="filter-label" htmlFor="category">Category</label>
          <select id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option value={item.slug} key={item.id}>{item.name}</option>)}
          </select>
          {(level || price || category || submittedQuery) && (
            <button className="filter-reset" onClick={clearFilters}>Clear all filters <X size={14} /></button>
          )}
          <div className="filter-tip"><Sparkles size={16} /><span>Try something outside your comfort zone. That’s where the fun starts.</span></div>
        </aside>
        <div className="catalog-results">
          <div className="results-topline">
            <div>
              <h2>{submittedQuery ? `Results for “${submittedQuery}”` : 'Explore all courses'}</h2>
              {!loading && !error && <span>{total} {total === 1 ? 'course' : 'courses'} to explore</span>}
            </div>
            <label className="sort-control">
              <span>Sort by</span>
              <select aria-label="Sort courses" value={sort} onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                next.set('sort', event.target.value);
                setSearchParams(next);
              }}>
                <option value="popular">Most popular</option>
                <option value="newest">Newest</option>
                <option value="rating">Top rated</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          {error ? <ErrorNotice message={error} /> : loading ? <CourseGridSkeleton /> : courses.length ? (
            <CourseGrid courses={courses} />
          ) : (
            <EmptyNotice title="No courses found just yet." message="Try a different search or clear your filters." />
          )}
        </div>
      </section>
    </main>
  );
}

function CoursePage() {
  const { slug = '' } = useParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError('');
    api<CourseDetail>(`/courses/${encodeURIComponent(slug)}`, { auth: Boolean(user) })
      .then(setCourse)
      .catch((cause: unknown) => setError(messageFor(cause)))
      .finally(() => setLoading(false));
  }, [slug, user]);

  if (loading) return <PageLoading />;
  if (error || !course) return <main className="page-wrap"><ErrorNotice message={error || 'Course not found.'} /><Link className="text-link" to="/courses"><ArrowLeft size={16} /> Back to courses</Link></main>;

  const lessons = course.sections.flatMap((section) => section.lessons);
  const enrollOrBuy = async () => {
    setActionError('');
    if (course.enrolled || course.isEnrolled) {
      navigate(`/learn/${course.id}`);
      return;
    }
    if (!user) {
      navigate('/login', { state: { from: `/courses/${course.slug}` } });
      return;
    }
    setBusy(true);
    try {
      if (course.priceMinor === 0) {
        await api('/enrollments', { method: 'POST', body: { courseId: course.id } });
        navigate(`/learn/${course.id}`);
      } else {
        const checkout = await api<{
          orderReference: string;
          provider: 'stripe' | 'local_test_gateway';
          url: string;
        }>('/checkout', { method: 'POST', body: { courseId: course.id } });
        if (checkout.provider === 'stripe') {
          window.location.assign(checkout.url);
          return;
        }
        navigate(`/checkout/${checkout.orderReference}?courseId=${course.id}`);
      }
    } catch (cause) {
      setActionError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="course-page">
      <div className="course-hero">
        <div className="course-hero-copy">
          <Link className="back-link" to="/courses"><ArrowLeft size={15} /> All courses</Link>
          <div className="eyebrow eyebrow-light">{course.category?.name ?? 'THE SKILLORA CLASSROOM'}</div>
          <h1>{course.title}</h1>
          {course.headline && <p className="course-headline">{course.headline}</p>}
          <div className="course-byline">
            <span className="avatar avatar-large">{initials(course.instructor.name)}</span>
            <span>Created by <strong>{course.instructor.name}</strong></span>
          </div>
          <div className="course-hero-stats">
            <span><Star size={15} fill="currentColor" /> {course.ratingAverage.toFixed(1)} <span>({course.ratingCount} reviews)</span></span>
            <span><Users size={16} /> {course.enrollmentCount.toLocaleString()} learners</span>
            <span><Clock3 size={16} /> {formatDuration(course.totalDurationSeconds)}</span>
          </div>
        </div>
        <div className="course-hero-art">
          {course.thumbnailUrl ? (
            <img src={course.thumbnailUrl} alt="" />
          ) : (
            <CourseArtwork course={course} index={2} />
          )}
          <div className="hero-art-sticker"><Sparkles size={17} /><span>Learn at<br />your own pace</span></div>
        </div>
      </div>

      <div className="course-detail-grid">
        <div className="course-main-column">
          <div className="course-tabs" aria-label="Course sections">
            <a href="#about">About</a><a href="#curriculum">Curriculum</a><a href="#instructor">Instructor</a><a href="#reviews">Reviews</a>
          </div>
          <section className="detail-section" id="about">
            <div className="eyebrow eyebrow-muted">THE COURSE</div>
            <h2>A little more about this class.</h2>
            <p className="course-description">{course.description || course.headline || 'A thoughtfully designed class to help you take your next step.'}</p>
            {course.objectives.length > 0 && (
              <>
                <h3>What you’ll learn</h3>
                <ul className="objective-list">{course.objectives.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
              </>
            )}
            {course.prerequisites.length > 0 && (
              <div className="prerequisites"><strong>Before you begin</strong><p>{course.prerequisites.join(' · ')}</p></div>
            )}
          </section>
          <section className="detail-section curriculum-section" id="curriculum">
            <div className="section-title-row"><div><div className="eyebrow eyebrow-muted">YOUR LEARNING PATH</div><h2>What’s inside.</h2></div><span>{course.sections.length} sections · {lessons.length} lessons</span></div>
            {course.sections.length ? course.sections.map((section, index) => (
              <details className="curriculum-accordion" key={section.id} open={index === 0}>
                <summary><span className="section-number">{String(index + 1).padStart(2, '0')}</span><strong>{section.title}</strong><span>{section.lessons.length} lessons</span><ChevronDown size={17} /></summary>
                <div className="curriculum-lessons">
                  {section.lessons.map((lesson) => <div className="curriculum-lesson" key={lesson.id}>
                    <span className="lesson-type-icon">{lesson.type === 'video' ? <CirclePlay size={16} /> : lesson.type === 'quiz' ? <Award size={16} /> : <BookOpen size={16} />}</span>
                    <span>{lesson.title}</span>
                    {lesson.isPreview && <span className="preview-tag">PREVIEW</span>}
                    <span className="lesson-length">{formatDuration(lesson.durationSeconds)}</span>
                    {!course.access?.canWatch && !lesson.isPreview && course.priceMinor > 0 && <LockKeyhole size={14} className="lesson-lock" />}
                  </div>)}
                </div>
              </details>
            )) : <p className="muted-copy">Course content is being prepared. Check back soon.</p>}
          </section>
          <section className="detail-section instructor-section" id="instructor">
            <div className="eyebrow eyebrow-muted">LEARN FROM A HUMAN</div>
            <h2>Your instructor.</h2>
            <div className="instructor-card">
              <span className="avatar instructor-avatar">{initials(course.instructor.name)}</span>
              <div><h3>{course.instructor.name}</h3><p>{course.instructorProfile?.headline || course.instructorProfile?.bio || 'Skillora instructor'}</p></div>
              <div className="instructor-metrics"><span><Star size={14} fill="currentColor" /> {course.instructorProfile?.ratingAverage?.toFixed(1) ?? course.ratingAverage.toFixed(1)}</span><span>{course.instructorProfile?.studentCount?.toLocaleString() ?? course.enrollmentCount.toLocaleString()} learners</span></div>
            </div>
          </section>
          <section className="detail-section reviews-section" id="reviews">
            <div className="eyebrow eyebrow-muted">KIND WORDS FROM LEARNERS</div>
            <h2>What people are saying.</h2>
            {course.review?.length ? <div className="review-grid">
              {course.review.slice(0, 4).map((review, index) => <article className="review-card" key={`${review.studentName}-${index}`}>
                <div className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} size={13} fill={i < review.rating ? 'currentColor' : 'none'} />)}</div>
                <p>{review.comment || 'A lovely course. I learned something new every day.'}</p>
                <strong>{review.studentName}</strong>
              </article>)}
            </div> : <p className="muted-copy">Be the first to share what you think of this class.</p>}
          </section>
        </div>
        <aside className="enroll-card">
          <div className="enroll-card-top">
            {course.thumbnailUrl ? <img src={course.thumbnailUrl} alt="" /> : <CourseArtwork course={course} index={0} />}
            <span className="enroll-play"><Play size={20} fill="currentColor" /></span>
          </div>
          <div className="enroll-card-body">
            <div className="enroll-price">{formatPrice(course.priceMinor, course.currency)}</div>
            <p>{course.priceMinor === 0 ? 'A lovely place to start. This class is free.' : 'One payment. Learn at your own pace, for as long as you like.'}</p>
            {actionError && <div className="form-error" role="alert">{actionError}</div>}
            <button className="button button-dark enroll-button" disabled={busy} onClick={() => void enrollOrBuy()}>
              {busy ? 'One moment…' : course.enrolled || course.isEnrolled ? 'Continue learning' : course.priceMinor === 0 ? 'Enroll for free' : 'Get instant access'}
              {!busy && <ArrowRight size={17} />}
            </button>
            <div className="enroll-reassurance"><CheckCircle2 size={16} /> Learn on your schedule</div>
            <div className="enroll-reassurance"><CheckCircle2 size={16} /> Full lifetime access</div>
            <div className="enroll-reassurance"><CheckCircle2 size={16} /> Certificate on completion</div>
            <div className="enroll-includes">
              <h3>This class includes</h3>
              <span><CirclePlay size={16} /> {formatDuration(course.totalDurationSeconds)} of lessons</span>
              <span><BookOpen size={16} /> {course.lessonCount} thoughtful lessons</span>
              <span><Award size={16} /> A certificate to celebrate</span>
            </div>
            <div className="payment-note"><ShieldCheck size={14} /> {course.priceMinor > 0 ? 'Secure checkout · full lifetime access' : 'No card needed · Start whenever you like'}</div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function LearningPage() {
  const [page, setPage] = useState<Page<Enrollment> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    api<Page<Enrollment>>('/enrollments?limit=50')
      .then(setPage)
      .catch((cause: unknown) => setError(messageFor(cause)))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return <Navigate to="/login" replace state={{ from: '/learn' }} />;
  return (
    <main className="learning-page">
      <div className="learning-heading">
        <div>
          <div className="eyebrow eyebrow-muted">YOUR SPACE TO GROW</div>
          <h1>Keep your <span className="serif-accent">curiosity</span> close.</h1>
          <p>Every minute you spend learning is a little promise to yourself.</p>
        </div>
        <Link className="button button-dark" to="/courses">Find another class <ArrowRight size={16} /></Link>
      </div>
      {error ? <ErrorNotice message={error} /> : loading ? <CourseGridSkeleton /> : page?.items.length ? (
        <div className="learning-grid">
          {page.items.map((enrollment, index) => <article className="learning-card" key={enrollment.id}>
            <Link className="learning-art-link" to={`/learn/${enrollment.courseId}`}>
              {enrollment.thumbnailUrl ? <img src={enrollment.thumbnailUrl} alt="" /> : <CourseArtwork course={{ title: enrollment.courseTitle }} index={index} />}
              <span className="learning-play"><Play size={19} fill="currentColor" /></span>
            </Link>
            <div className="learning-card-content">
              <span className="eyebrow eyebrow-muted">YOUR CLASS</span>
              <Link to={`/learn/${enrollment.courseId}`}><h2>{enrollment.courseTitle}</h2></Link>
              <div className="learning-progress-label"><span>{enrollment.completedLessons} of {enrollment.totalLessons} lessons</span><strong>{Math.round(enrollment.progressPercent)}%</strong></div>
              <div className="progress-track"><span style={{ width: `${Math.min(100, enrollment.progressPercent)}%` }} /></div>
              <Link className="text-link learning-continue" to={`/learn/${enrollment.courseId}`}>
                {enrollment.progressPercent >= 100 ? 'Revisit this class' : 'Pick up where you left off'} <ArrowRight size={15} />
              </Link>
            </div>
          </article>)}
        </div>
      ) : (
        <div className="learning-empty">
          <div className="empty-illustration"><BookOpen size={33} /><span><Sparkles size={16} /></span></div>
          <h2>Your next favorite class is waiting.</h2>
          <p>When you enroll in a course, you’ll find it here—ready whenever you are.</p>
          <Link className="button button-dark" to="/courses">Explore courses <ArrowRight size={16} /></Link>
        </div>
      )}
    </main>
  );
}

function InstructorPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || (user.role !== 'instructor' && user.role !== 'admin')) return;
    api<Page<Course>>('/instructor/courses?limit=50')
      .then((page) => setCourses(page.items))
      .catch((cause: unknown) => setError(messageFor(cause)))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) return <Navigate to="/login" replace state={{ from: '/teach' }} />;
  if (user.role !== 'instructor' && user.role !== 'admin') {
    return <main className="notice-page">
      <div className="notice-symbol"><GraduationCap size={25} /></div>
      <div className="eyebrow eyebrow-muted">SHARE WHAT YOU KNOW</div>
      <h1>Make a little room for <span className="serif-accent">teaching.</span></h1>
      <p>Teaching tools are available to instructor accounts. Sign out and create an instructor account to start sharing your work.</p>
      <Link className="button button-dark" to="/register">Create an instructor account <ArrowRight size={16} /></Link>
    </main>;
  }

  const createCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const course = await api<Course>('/instructor/courses', {
        method: 'POST',
        body: { title },
      });
      navigate(`/teach/courses/${course.id}`);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="teach-page">
      <div className="teach-heading">
        <div><div className="eyebrow eyebrow-muted">YOUR TEACHING STUDIO</div><h1>Ideas are better <span className="serif-accent">shared.</span></h1><p>Build a class, share what you know, and help someone take their next step.</p></div>
        <Link className="button button-dark" to="/teach#new-course">Create a class <ArrowRight size={16} /></Link>
      </div>
      {error && <ErrorNotice message={error} />}
      <section className="teach-create" id="new-course">
        <span className="teach-create-icon"><Sparkles size={20} /></span>
        <div><strong>Start with a small idea.</strong><p>Give your class a name. You can fill in the details and lessons next.</p></div>
        <form onSubmit={(event) => void createCourse(event)}>
          <label className="visually-hidden" htmlFor="new-course-title">Class title</label>
          <input id="new-course-title" required minLength={4} maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Finding your voice in watercolor" />
          <button className="button button-dark button-small" disabled={creating}>{creating ? 'Creating…' : 'Start a class'} <ArrowRight size={14} /></button>
        </form>
      </section>
      <section className="teach-courses">
        <div className="teach-list-heading"><div><div className="eyebrow eyebrow-muted">YOUR WORKSHOP</div><h2>Your classes.</h2></div>{!loading && <span>{courses.length} {courses.length === 1 ? 'class' : 'classes'}</span>}</div>
        {loading ? <div className="teach-loading"><span className="loading-dot" /></div> : courses.length ? (
          <div className="teach-course-list">
            {courses.map((course, index) => <Link className="teach-course-row" to={`/teach/courses/${course.id}`} key={course.id}>
              <span className="teach-course-art"><CourseArtwork course={course} index={index} /></span>
              <span className="teach-course-copy"><strong>{course.title}</strong><small>{course.lessonCount} lessons · {formatPrice(course.priceMinor, course.currency)}</small></span>
              <span className={`status-pill status-${course.status}`}>{course.status.replace('_', ' ')}</span>
              <ArrowRight size={16} />
            </Link>)}
          </div>
        ) : <EmptyNotice title="Your first class starts here." message="Create a class above and shape it into something learners will love." />}
      </section>
    </main>
  );
}

function CourseEditorPage() {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [level, setLevel] = useState('beginner');
  const [price, setPrice] = useState('0');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [objectivesText, setObjectivesText] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [lessonSectionId, setLessonSectionId] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonContent, setLessonContent] = useState('');
  const [lessonType, setLessonType] = useState<'text' | 'quiz'>('text');
  const [quizLessonId, setQuizLessonId] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [correctOption, setCorrectOption] = useState('a');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const loadCourse = async () => {
    const [detail, categoryRows] = await Promise.all([
      api<CourseDetail>(`/instructor/courses/${encodeURIComponent(courseId)}`),
      api<Category[]>('/categories', { auth: false }),
    ]);
    setCourse(detail);
    setCategories(categoryRows);
    setTitle(detail.title);
    setHeadline(detail.headline ?? '');
    setDescription(detail.description);
    setCategoryId(detail.category?.id ?? '');
    setLevel(detail.level);
    setPrice(String(detail.priceMinor / 100));
    setThumbnailUrl(detail.thumbnailUrl ?? '');
    setObjectivesText(detail.objectives.join('\n'));
    setLessonSectionId((current) => current || detail.sections[0]?.id || '');
    setQuizTitle(`A quick reflection: ${detail.title}`);
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    Promise.all([
      api<CourseDetail>(`/instructor/courses/${encodeURIComponent(courseId)}`),
      api<Category[]>('/categories', { auth: false }),
    ])
      .then(([detail, categoryRows]) => {
        if (!active) return;
        setCourse(detail);
        setCategories(categoryRows);
        setTitle(detail.title);
        setHeadline(detail.headline ?? '');
        setDescription(detail.description);
        setCategoryId(detail.category?.id ?? '');
        setLevel(detail.level);
        setPrice(String(detail.priceMinor / 100));
        setThumbnailUrl(detail.thumbnailUrl ?? '');
        setObjectivesText(detail.objectives.join('\n'));
        setLessonSectionId(detail.sections[0]?.id ?? '');
        setQuizTitle(`A quick reflection: ${detail.title}`);
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId, user]);

  if (!user) return <Navigate to="/login" replace state={{ from: `/teach/courses/${courseId}` }} />;
  if (user.role !== 'instructor' && user.role !== 'admin') return <Navigate to="/teach" replace />;
  if (loading) return <PageLoading />;
  if (error && !course) return <main className="page-wrap"><ErrorNotice message={error} /></main>;
  if (!course) return <main className="page-wrap"><ErrorNotice message="Course not found." /></main>;

  const saveBasics = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const objectives = objectivesText.split('\n').map((item) => item.trim()).filter(Boolean);
      const updated = await api<CourseDetail>(`/instructor/courses/${encodeURIComponent(courseId)}`, {
        method: 'PATCH',
        body: {
          title,
          headline: headline || null,
          description,
          ...(categoryId ? { categoryId } : {}),
          level,
          priceMinor: Math.round(Number(price || 0) * 100),
          thumbnailUrl: thumbnailUrl || null,
          objectives,
        },
      });
      setCourse((current) => current ? { ...current, ...updated } : current);
      setMessage('Class details saved.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const addSection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/instructor/courses/${encodeURIComponent(courseId)}/sections`, {
        method: 'POST',
        body: { title: sectionTitle },
      });
      setSectionTitle('');
      await loadCourse();
      setMessage('Section added.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const addLesson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!lessonSectionId) {
      setError('Add a section before creating a lesson.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const lesson = await api<{ id: string }>(`/instructor/sections/${encodeURIComponent(lessonSectionId)}/lessons`, {
        method: 'POST',
        body: {
          title: lessonTitle,
          type: lessonType,
          content: lessonType === 'text' ? lessonContent : null,
          durationSeconds: 0,
          isPublished: true,
          isPreview: false,
        },
      });
      if (lessonType === 'quiz') setQuizLessonId(lesson.id);
      setLessonTitle('');
      setLessonContent('');
      await loadCourse();
      setMessage(lessonType === 'quiz' ? 'Quiz lesson added. Add its questions below.' : 'Lesson added.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const createQuiz = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quizLessonId) {
      setError('Create a quiz lesson first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/instructor/courses/${encodeURIComponent(courseId)}/quizzes`, {
        method: 'POST',
        body: {
          title: quizTitle,
          lessonId: quizLessonId,
          passScorePercent: 60,
          maxAttempts: 3,
          timeLimitSeconds: null,
          randomizeQuestions: false,
          randomizeOptions: false,
          questions: [{
            type: 'single_choice',
            prompt: question,
            points: 1,
            options: [{ id: 'a', text: optionA }, { id: 'b', text: optionB }],
            correctOptionIds: [correctOption],
          }],
        },
      });
      setQuizLessonId('');
      setQuestion('');
      setMessage('Quiz created and attached to its lesson.');
      await loadCourse();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/instructor/courses/${encodeURIComponent(courseId)}/publish`, {
        method: 'POST',
        body: { action: 'submit' },
      });
      await loadCourse();
      setMessage('Your class has been submitted for review.');
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="editor-page">
      <div className="editor-top"><Link className="back-link" to="/teach"><ArrowLeft size={15} /> Your classes</Link><span className={`status-pill status-${course.status}`}>{course.status.replace('_', ' ')}</span></div>
      <div className="editor-heading"><div className="eyebrow eyebrow-muted">CLASS BUILDER</div><h1>Shape your <span className="serif-accent">class.</span></h1><p>A good class starts with a clear promise and a few thoughtful lessons.</p></div>
      {(error || message) && <div className={error ? 'form-error editor-message' : 'editor-success'} role={error ? 'alert' : 'status'}>{error || message}</div>}
      <div className="editor-grid">
        <form className="editor-card editor-details" onSubmit={(event) => void saveBasics(event)}>
          <div className="editor-card-heading"><span className="editor-step">01</span><div><h2>Class details</h2><p>Tell learners what they’ll discover.</p></div></div>
          <label htmlFor="editor-title">Class title</label><input id="editor-title" required minLength={4} maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} />
          <label htmlFor="editor-headline">Short headline</label><input id="editor-headline" maxLength={160} value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="A thoughtful one-line introduction" />
          <label htmlFor="editor-description">Description <span>At least 40 characters to submit</span></label><textarea id="editor-description" required minLength={40} maxLength={20000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the class and who it’s for." />
          <label htmlFor="editor-category">Category</label><select id="editor-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
          <div className="editor-form-row"><div><label htmlFor="editor-level">Experience level</label><select id="editor-level" value={level} onChange={(event) => setLevel(event.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div><div><label htmlFor="editor-price">Price (USD)</label><input id="editor-price" type="number" min="0" max="100000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></div></div>
          <label htmlFor="editor-thumbnail">Thumbnail image URL</label><input id="editor-thumbnail" type="url" maxLength={600} value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://…" />
          <label htmlFor="editor-objectives">What learners will take away <span>One objective per line</span></label><textarea id="editor-objectives" rows={3} value={objectivesText} onChange={(event) => setObjectivesText(event.target.value)} placeholder="Learn one useful thing&#10;Practice it with confidence" />
          <button className="button button-dark button-small" disabled={busy}>{busy ? 'Saving…' : 'Save class details'} <Check size={14} /></button>
        </form>
        <div className="editor-right-column">
          <section className="editor-card">
            <div className="editor-card-heading"><span className="editor-step">02</span><div><h2>Learning path</h2><p>Organize your class into sections and lessons.</p></div></div>
            <div className="editor-sections">
              {course.sections.map((section, index) => <div className="editor-section" key={section.id}>
                <div className="editor-section-heading"><span>{String(index + 1).padStart(2, '0')}</span><strong>{section.title}</strong></div>
                {section.lessons.map((lesson) => <div className="editor-lesson" key={lesson.id}><BookOpen size={14} /><span>{lesson.title}</span><small>{lesson.type}</small></div>)}
              </div>)}
            </div>
            <form className="editor-inline-form" onSubmit={(event) => void addSection(event)}>
              <label htmlFor="section-title">Add a section</label>
              <div><input id="section-title" required minLength={2} maxLength={140} value={sectionTitle} onChange={(event) => setSectionTitle(event.target.value)} placeholder="e.g. Getting started" /><button className="button button-outline button-small" disabled={busy}>Add section</button></div>
            </form>
            <form className="editor-inline-form" onSubmit={(event) => void addLesson(event)}>
              <label htmlFor="lesson-section">Add a lesson</label>
              <select id="lesson-section" required value={lessonSectionId} onChange={(event) => setLessonSectionId(event.target.value)}><option value="">Choose a section</option>{course.sections.map((section) => <option value={section.id} key={section.id}>{section.title}</option>)}</select>
              <input required minLength={2} maxLength={140} value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} placeholder="Lesson title" />
              <select value={lessonType} onChange={(event) => setLessonType(event.target.value as 'text' | 'quiz')} aria-label="Lesson format"><option value="text">Reading lesson</option><option value="quiz">Quiz lesson</option></select>
              {lessonType === 'text' && <textarea required maxLength={50000} rows={3} value={lessonContent} onChange={(event) => setLessonContent(event.target.value)} placeholder="Write the lesson content here." aria-label="Lesson content" />}
              <button className="button button-outline button-small" disabled={busy || !course.sections.length}>Add lesson <ArrowRight size={14} /></button>
            </form>
          </section>
          {quizLessonId && <form className="editor-card quiz-author-form" onSubmit={(event) => void createQuiz(event)}>
            <div className="editor-card-heading"><span className="editor-step">03</span><div><h2>Add a quiz question</h2><p>One question is enough to get started. Add more from your quiz dashboard.</p></div></div>
            <label htmlFor="quiz-title">Quiz title</label><input id="quiz-title" required minLength={2} maxLength={140} value={quizTitle} onChange={(event) => setQuizTitle(event.target.value)} />
            <label htmlFor="quiz-question">Question</label><input id="quiz-question" required minLength={2} maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} />
            <label htmlFor="quiz-option-a">Option one</label><input id="quiz-option-a" required minLength={1} maxLength={600} value={optionA} onChange={(event) => setOptionA(event.target.value)} />
            <label htmlFor="quiz-option-b">Option two</label><input id="quiz-option-b" required minLength={1} maxLength={600} value={optionB} onChange={(event) => setOptionB(event.target.value)} />
            <label htmlFor="quiz-correct">Correct answer</label><select id="quiz-correct" value={correctOption} onChange={(event) => setCorrectOption(event.target.value)}><option value="a">Option one</option><option value="b">Option two</option></select>
            <button className="button button-dark button-small" disabled={busy}>Create quiz <Check size={14} /></button>
          </form>}
          <section className="submit-card">
            <div className="eyebrow eyebrow-muted">READY FOR THE CLASSROOM?</div>
            <h2>Let’s share it.</h2>
            <p>Your class will be checked against the publishing requirements before it appears in the catalog.</p>
            {course.status === 'published' ? <Link className="text-link" to={`/courses/${course.slug}`} target="_blank">View published class <ArrowRight size={14} /></Link> : (
              <button className="button button-dark button-small" disabled={busy || course.status === 'pending_review'} onClick={() => void submitForReview()}>
                {course.status === 'pending_review' ? 'Under review' : 'Submit for review'} <ArrowRight size={14} />
              </button>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function PlayerPage() {
  const { courseId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [player, setPlayer] = useState<LessonPlayer | null>(null);
  const [courseProgress, setCourseProgress] = useState<{ progressPercent: number; completedLessons: number; totalLessons: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [error, setError] = useState('');
  const [completeBusy, setCompleteBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const watchedRef = useRef(0);
  const previousTimeRef = useRef(0);
  const lastSavedRef = useRef(0);
  const selectedLessonId = searchParams.get('lesson');
  const lessons = useMemo(() => course?.sections.flatMap((section) => section.lessons) ?? [], [course]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      api<CourseDetail>(`/courses/${encodeURIComponent(courseId)}`),
      api<{ nextLessonId: string | null; enrolled: boolean; progressPercent: number; completedLessons: number; totalLessons: number }>(`/enrollments/${encodeURIComponent(courseId)}`),
    ])
      .then(([detail, progress]) => {
        if (!active) return;
        setCourse(detail);
        setCourseProgress({
          progressPercent: progress.progressPercent,
          completedLessons: progress.completedLessons,
          totalLessons: progress.totalLessons,
        });
        const firstLessonId = progress.nextLessonId ?? detail.sections.flatMap((section) => section.lessons)[0]?.id;
        if (!selectedLessonId && firstLessonId) {
          const next = new URLSearchParams(searchParams);
          next.set('lesson', firstLessonId);
          setSearchParams(next, { replace: true });
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseId]);

  useEffect(() => {
    if (!selectedLessonId) return;
    let active = true;
    setPlayerLoading(true);
    setNotice('');
    api<LessonPlayer>(`/lessons/${encodeURIComponent(selectedLessonId)}/player`)
      .then((data) => {
        if (active) {
          setPlayer(data);
          watchedRef.current = data.progress.watchedSeconds;
          previousTimeRef.current = data.progress.lastPositionSeconds;
          lastSavedRef.current = Date.now();
        }
      })
      .catch((cause: unknown) => {
        if (active) setNotice(messageFor(cause));
      })
      .finally(() => {
        if (active) setPlayerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedLessonId]);

  useEffect(() => {
    const video = videoRef.current;
    const playlistUrl = player?.video?.playlistUrl;
    if (!video || !playlistUrl) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      return;
    }
    if (!Hls.isSupported()) {
      setNotice('This browser cannot play HLS video. Try the latest version of Chrome, Firefox or Safari.');
      return;
    }
    const hls = new Hls({ enableWorker: true });
    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setNotice('The video could not be played. Please refresh the lesson and try again.');
    });
    return () => hls.destroy();
  }, [player?.video?.playlistUrl, player?.lesson.id]);

  const saveVideoProgress = async (positionSeconds: number, durationSeconds: number) => {
    if (!player) return;
    try {
      const progress = await api<{ completed: boolean }>('/progress', {
        method: 'POST',
        body: {
          lessonId: player.lesson.id,
          watchedSeconds: Math.floor(watchedRef.current),
          positionSeconds: Math.floor(positionSeconds),
          durationSeconds: Math.floor(durationSeconds),
        },
      });
      if (progress.completed) {
        setPlayer((current) => current ? { ...current, progress: { ...current.progress, completed: true } } : current);
        const summary = await api<{ progressPercent: number; completedLessons: number; totalLessons: number }>(
          `/enrollments/${encodeURIComponent(courseId)}`,
        );
        setCourseProgress(summary);
      }
    } catch (cause) {
      setNotice(messageFor(cause));
    }
  };

  const updateWatch = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const currentTime = video.currentTime;
    const delta = currentTime - previousTimeRef.current;
    if (!video.paused && delta > 0 && delta <= 3) watchedRef.current += delta;
    previousTimeRef.current = currentTime;
    if (Date.now() - lastSavedRef.current > 15_000 && video.duration > 0) {
      lastSavedRef.current = Date.now();
      void saveVideoProgress(currentTime, video.duration);
    }
  };

  const markComplete = async () => {
    if (!player) return;
    setCompleteBusy(true);
    setNotice('');
    try {
      await api(`/progress/${encodeURIComponent(player.lesson.id)}/complete`, { method: 'POST' });
      setPlayer((current) => current ? { ...current, progress: { ...current.progress, completed: true } } : current);
      setCourseProgress(await api<{ progressPercent: number; completedLessons: number; totalLessons: number }>(
        `/enrollments/${encodeURIComponent(courseId)}`,
      ));
    } catch (cause) {
      setNotice(messageFor(cause));
    } finally {
      setCompleteBusy(false);
    }
  };

  const selectLesson = (lesson: Lesson) => {
    setSearchParams({ lesson: lesson.id });
  };

  if (loading) return <PageLoading />;
  if (error || !course) return <main className="page-wrap"><ErrorNotice message={error || 'Course not found.'} /><Link className="text-link" to="/learn"><ArrowLeft size={16} /> Back to my learning</Link></main>;

  return (
    <main className="player-page">
      <div className="player-topbar">
        <Link to="/learn" className="back-link"><ArrowLeft size={15} /> My learning</Link>
        <span className="player-course-title">{course.title}</span>
        <Link className="player-progress-link" to="/learn">{Math.round(courseProgress?.progressPercent ?? 0)}% complete <ChevronRight size={15} /></Link>
      </div>
      <div className="player-layout">
        <section className="lesson-stage">
          {playerLoading ? <div className="video-loading"><span className="loading-dot" /></div> : player ? (
            <>
              {player.lesson.type === 'video' ? (
                <div className="video-frame">
                  {player.video?.playlistUrl ? (
                    <video
                      ref={videoRef}
                      key={player.lesson.id}
                      controls
                      playsInline
                      poster={player.video.posterUrl ?? undefined}
                      onTimeUpdate={updateWatch}
                      onLoadedMetadata={(event) => {
                        const position = player.progress.lastPositionSeconds;
                        if (position > 0) {
                          event.currentTarget.currentTime = position;
                          previousTimeRef.current = position;
                        }
                      }}
                      onPause={(event) => {
                        if (event.currentTarget.duration > 0) void saveVideoProgress(event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                      onEnded={(event) => {
                        if (event.currentTarget.duration > 0) void saveVideoProgress(event.currentTarget.currentTime, event.currentTarget.duration);
                      }}
                    />
                  ) : (
                    <div className="video-unavailable">
                      <CirclePlay size={44} />
                      <h2>{player.video?.status === 'PROCESSING' || player.video?.status === 'QUEUED' ? 'Your lesson is getting ready.' : 'Video coming soon.'}</h2>
                      <p>{player.video?.error || 'The instructor is preparing this lesson. Come back in a little while.'}</p>
                    </div>
                  )}
                </div>
              ) : player.lesson.type === 'text' ? (
                <article className="text-lesson">
                  <div className="eyebrow eyebrow-muted">READ & REFLECT</div>
                  <h1>{player.lesson.title}</h1>
                  <div className="lesson-rich-text">{player.lesson.content || 'Your instructor is preparing the notes for this lesson.'}</div>
                </article>
              ) : player.lesson.type === 'attachment' ? (
                <div className="attachment-lesson">
                  <div className="attachment-symbol"><BookOpen size={32} /></div>
                  <div className="eyebrow eyebrow-muted">LEARNING MATERIAL</div>
                  <h1>{player.lesson.title}</h1>
                  <p>Download the materials, take your time, and mark this lesson complete when you’re ready.</p>
                  {player.lesson.resources.map((resource) => <a className="resource-link" href={resource.url} key={resource.id} target="_blank" rel="noreferrer"><BookOpen size={17} />{resource.title}<ArrowRight size={15} /></a>)}
                </div>
              ) : (
                <QuizPlayer quiz={player.quiz} onPassed={() => {
                  setPlayer((current) => current ? { ...current, progress: { ...current.progress, completed: true } } : current);
                  void api<{ progressPercent: number; completedLessons: number; totalLessons: number }>(
                    `/enrollments/${encodeURIComponent(courseId)}`,
                  ).then(setCourseProgress).catch((cause: unknown) => setNotice(messageFor(cause)));
                }} />
              )}
              {notice && <div className="player-notice" role="alert">{notice}</div>}
              <div className="lesson-information">
                <div><div className="eyebrow eyebrow-muted">NOW LEARNING</div><h2>{player.lesson.title}</h2></div>
                {player.progress.completed ? <span className="complete-badge"><CheckCircle2 size={16} /> Completed</span> : player.lesson.type !== 'video' && player.lesson.type !== 'quiz' ? (
                  <button className="button button-dark button-small" disabled={completeBusy} onClick={() => void markComplete()}>
                    {completeBusy ? 'Saving…' : 'Mark complete'} <Check size={15} />
                  </button>
                ) : null}
              </div>
            </>
          ) : <EmptyNotice title="There are no lessons here yet." message="The instructor is still creating this class." />}
        </section>
        <aside className="lesson-sidebar">
          <div className="sidebar-course-heading"><span className="eyebrow eyebrow-muted">YOUR CLASS</span><h2>{course.title}</h2><p>{lessons.length} lessons · {formatDuration(course.totalDurationSeconds)}</p></div>
          <div className="sidebar-progress">
            <div className="sidebar-progress-top"><span>YOUR PROGRESS</span><strong>{Math.round(courseProgress?.progressPercent ?? 0)}%</strong></div>
            <div className="progress-track"><span style={{ width: `${Math.min(100, courseProgress?.progressPercent ?? 0)}%` }} /></div>
          </div>
          <div className="sidebar-sections">
            {course.sections.map((section, index) => <section className="sidebar-section" key={section.id}>
              <div className="sidebar-section-title"><span>{String(index + 1).padStart(2, '0')}</span><strong>{section.title}</strong><span>{section.lessons.length}</span></div>
              {section.lessons.map((lesson) => <button
                className={`sidebar-lesson ${selectedLessonId === lesson.id ? 'sidebar-lesson-active' : ''}`}
                key={lesson.id}
                onClick={() => selectLesson(lesson)}
              >
                <span className="sidebar-lesson-icon">{lesson.type === 'video' ? <Play size={13} /> : lesson.type === 'quiz' ? <Award size={14} /> : <BookOpen size={14} />}</span>
                <span className="sidebar-lesson-copy"><span>{lesson.title}</span><small>{formatDuration(lesson.durationSeconds)}</small></span>
                {player?.lesson.id === lesson.id && player.progress.completed && <CheckCircle2 className="sidebar-check" size={16} />}
              </button>)}
            </section>)}
          </div>
          <div className="sidebar-certificate"><Award size={19} /><span><strong>Keep going!</strong><small>Finish every lesson to earn your certificate.</small></span></div>
        </aside>
      </div>
    </main>
  );
}

function QuizPlayer({
  quiz,
  onPassed,
}: {
  quiz: LessonPlayer['quiz'];
  onPassed: () => void;
}) {
  const [session, setSession] = useState<QuizSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<{ scorePercent: number; passed: boolean; pointsEarned: number; pointsTotal: number } | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const submitRef = useRef<() => void>(() => undefined);

  const startAttempt = async () => {
    if (!quiz) return;
    setLoading(true);
    setError('');
    try {
      const next = await api<QuizSession>(`/quizzes/${encodeURIComponent(quiz.id)}/start`, { method: 'POST' });
      setSession(next);
      setAnswers({});
      setResult(null);
      setAttemptCount(next.attemptNumber);
      setSecondsLeft(next.remainingSeconds);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!quiz) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      api<{
        passed: boolean;
        attempts: { scorePercent: number; passed: boolean; pointsEarned: number; pointsTotal: number }[];
        maxAttempts: number;
      }>(`/quizzes/${encodeURIComponent(quiz.id)}/attempts`),
    ])
      .then(async ([history]) => {
        if (!active) return;
        setAttemptCount(history.attempts.length);
        const passedAttempt = [...history.attempts].reverse().find((attempt) => attempt.passed);
        if (passedAttempt) {
          setResult(passedAttempt);
          return;
        }
        if (history.attempts.length >= history.maxAttempts) {
          const lastAttempt = history.attempts[history.attempts.length - 1];
          if (lastAttempt) setResult(lastAttempt);
          else setError(`You have reached the ${history.maxAttempts}-attempt limit.`);
          return;
        }
        const next = await api<QuizSession>(`/quizzes/${encodeURIComponent(quiz.id)}/start`, { method: 'POST' });
        if (active) {
          setSession(next);
          setAttemptCount(next.attemptNumber);
          setSecondsLeft(next.remainingSeconds);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFor(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [quiz?.id]);

  const submitAttempt = async () => {
    if (!quiz || !session || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const graded = await api<{ scorePercent: number; passed: boolean; pointsEarned: number; pointsTotal: number }>(
        `/quizzes/${encodeURIComponent(quiz.id)}/submit`,
        {
          method: 'POST',
          body: {
            answers: session.questions.map((question) => ({
              questionId: question.id,
              optionIds: answers[question.id] ?? [],
            })),
          },
        },
      );
      setResult(graded);
      setSession(null);
      if (graded.passed) onPassed();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  submitRef.current = () => void submitAttempt();

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0 || !session || !quiz?.timeLimitSeconds) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((remaining) => {
        if (remaining === null) return null;
        if (remaining <= 1) {
          window.clearInterval(timer);
          window.setTimeout(() => submitRef.current(), 0);
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft, session, quiz?.timeLimitSeconds]);

  const chooseOption = (questionId: string, optionId: string, multi: boolean) => {
    setAnswers((current) => {
      const selected = current[questionId] ?? [];
      const next = multi
        ? selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]
        : selected.includes(optionId) ? [] : [optionId];
      return { ...current, [questionId]: next };
    });
  };

  return (
    <section className="quiz-lesson quiz-player">
      <div className="attachment-symbol"><Award size={32} /></div>
      <div className="eyebrow eyebrow-muted">CHECK YOUR UNDERSTANDING</div>
      <h1>{quiz?.title ?? 'Course quiz'}</h1>
      {quiz?.description && <p>{quiz.description}</p>}
      {quiz && <div className="quiz-details">{quiz.questionCount} questions <span>·</span> Pass at {quiz.passScorePercent}% <span>·</span> Attempt {Math.max(1, attemptCount)} of {quiz.maxAttempts}</div>}
      {!quiz ? <p>This lesson doesn’t have an active quiz yet.</p> : loading ? (
        <div className="quiz-inline-loading"><span className="loading-dot" /></div>
      ) : result ? (
        <div className={`quiz-result ${result.passed ? 'quiz-result-passed' : 'quiz-result-failed'}`}>
          <div className="quiz-result-icon">{result.passed ? <CheckCircle2 size={26} /> : <Award size={25} />}</div>
          <strong>{result.passed ? 'Nicely done—you passed.' : 'Good effort. Keep learning.'}</strong>
          <span>You scored {result.scorePercent}% ({result.pointsEarned} of {result.pointsTotal} points).</span>
          {!result.passed && attemptCount < quiz.maxAttempts && <button className="button button-dark button-small" disabled={loading} onClick={() => void startAttempt()}>Try again <ArrowRight size={14} /></button>}
        </div>
      ) : session ? (
        <>
          {secondsLeft !== null && <div className="quiz-timer"><Clock3 size={15} /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} remaining</div>}
          <div className="quiz-questions">
            {session.questions.map((question, index) => <fieldset className="quiz-question" key={question.id} disabled={submitting}>
              <legend><span>{String(index + 1).padStart(2, '0')}</span>{question.prompt}<small>{question.points} {question.points === 1 ? 'point' : 'points'}</small></legend>
              <div className="quiz-options">
                {question.options.map((option) => {
                  const checked = (answers[question.id] ?? []).includes(option.id);
                  const multi = question.type === 'multi_choice';
                  return <label className={`quiz-option ${checked ? 'quiz-option-selected' : ''}`} key={option.id}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`answer-${question.id}`}
                      checked={checked}
                      onChange={() => chooseOption(question.id, option.id, multi)}
                    />
                    <span className="quiz-option-marker">{checked && <Check size={12} />}</span>
                    <span>{option.text}</span>
                  </label>;
                })}
              </div>
            </fieldset>)}
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-dark quiz-submit" disabled={submitting} onClick={() => void submitAttempt()}>{submitting ? 'Grading your answers…' : 'Submit answers'} <ArrowRight size={15} /></button>
        </>
      ) : (
        <>
          {error && <div className="form-error" role="alert">{error}</div>}
          {attemptCount >= quiz.maxAttempts && <p>You’ve used all available attempts for this quiz.</p>}
          {attemptCount < quiz.maxAttempts && <button className="button button-dark button-small" onClick={() => void startAttempt()}>Start quiz <ArrowRight size={14} /></button>}
        </>
      )}
    </section>
  );
}

function CheckoutPage() {
  const { reference = '' } = useParams();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId') ?? '';
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [cardName, setCardName] = useState('');
  const [expMonth, setExpMonth] = useState('12');
  const [expYear, setExpYear] = useState(String(new Date().getFullYear() + 1));
  const [cvc, setCvc] = useState('123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace state={{ from: `/checkout/${reference}?courseId=${courseId}` }} />;
  const pay = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ result: 'success' | 'decline' }>(
        `/payments/test-gateway/${encodeURIComponent(reference)}/confirm`,
        {
          method: 'POST',
          body: {
            number: cardNumber.replace(/[\s-]/g, ''),
            expMonth: Number(expMonth),
            expYear: Number(expYear),
            cvc,
            name: cardName,
          },
        },
      );
      if (result.result === 'success') {
        navigate(courseId ? `/learn/${courseId}` : '/learn', { replace: true });
      } else {
        setError('That test card was declined. Try the successful test card shown below.');
      }
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="checkout-page">
      <div className="checkout-top"><Link className="brand" to="/"><span className="brand-mark"><GraduationCap size={21} /></span><span>skillora<span className="brand-period">.</span></span></Link><span><LockKeyhole size={15} /> Secure test checkout</span></div>
      <div className="checkout-layout">
        <div className="checkout-main">
          <Link className="back-link" to={courseId ? `/courses/${courseId}` : '/courses'}><ArrowLeft size={15} /> Back to class</Link>
          <div className="eyebrow eyebrow-muted">LOCAL TEST MODE</div>
          <h1>Make this class <span className="serif-accent">yours.</span></h1>
          <p className="checkout-explainer">This is Skillora’s simulated payment gateway. No real payment will be taken.</p>
          <div className="simulation-banner"><ShieldCheck size={18} /><span><strong>Simulated payment only</strong><small>Use the test card below. Never enter real card details here.</small></span><span className="simulated-tag">TEST MODE</span></div>
          <form className="checkout-form" onSubmit={(event) => void pay(event)}>
            <label htmlFor="card-name">Name on card</label>
            <input id="card-name" autoComplete="cc-name" required minLength={2} value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="Alex Morgan" />
            <label htmlFor="card-number">Test card number</label>
            <input id="card-number" inputMode="numeric" autoComplete="off" required value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} />
            <div className="checkout-fields">
              <div><label htmlFor="card-exp-month">Expiry month</label><select id="card-exp-month" value={expMonth} onChange={(event) => setExpMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index}>{String(index + 1).padStart(2, '0')}</option>)}</select></div>
              <div><label htmlFor="card-exp-year">Expiry year</label><select id="card-exp-year" value={expYear} onChange={(event) => setExpYear(event.target.value)}>{Array.from({ length: 8 }, (_, index) => <option value={new Date().getFullYear() + index} key={index}>{new Date().getFullYear() + index}</option>)}</select></div>
              <div><label htmlFor="card-cvc">CVC</label><input id="card-cvc" inputMode="numeric" autoComplete="off" required minLength={3} maxLength={4} value={cvc} onChange={(event) => setCvc(event.target.value)} /></div>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button button-dark checkout-submit" disabled={busy}>{busy ? 'Confirming test payment…' : 'Confirm simulated payment'} <ArrowRight size={16} /></button>
          </form>
          <div className="test-card-note"><CheckCircle2 size={16} /><span><strong>Success card:</strong> 4242 4242 4242 4242 · any future expiry · any 3-digit CVC</span></div>
          <div className="test-card-note test-card-note-muted"><X size={15} /><span>Decline card: 4000 0000 0000 0002</span></div>
          <p className="order-reference">Order reference: {reference}</p>
        </div>
        <aside className="checkout-side">
          <div className="checkout-side-art"><div className="callout-sun" /><BookOpen size={39} /></div>
          <div className="eyebrow eyebrow-muted">A CLASS YOU’LL KEEP</div>
          <h2>Good choice.</h2>
          <p>Your class will be waiting for you as soon as the test payment is confirmed.</p>
          <div className="checkout-benefit"><CheckCircle2 size={16} /> Lifetime course access</div>
          <div className="checkout-benefit"><CheckCircle2 size={16} /> Learn on any device</div>
          <div className="checkout-benefit"><CheckCircle2 size={16} /> Certificate on completion</div>
        </aside>
      </div>
    </main>
  );
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const isRegister = mode === 'register';
  const { user, signIn, signUp } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as { from?: string } | null)?.from ?? (isRegister ? '/courses' : '/learn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'instructor'>('student');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isRegister) await signUp({ name, email, password, role });
      else await signIn(email, password);
      navigate(from, { replace: true });
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-card-top"><span className="auth-icon"><GraduationCap size={23} /></span><span className="eyebrow eyebrow-muted">{isRegister ? 'A NEW CHAPTER' : 'WELCOME BACK'}</span></div>
        <h1>{isRegister ? <>A good place to <span className="serif-accent">begin.</span></> : <>Good to see <span className="serif-accent">you.</span></>}</h1>
        <p>{isRegister ? 'Make an account and find out what you’re capable of.' : 'Pick up right where your curiosity left off.'}</p>
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {isRegister && <>
            <label htmlFor="auth-name">Your name</label>
            <input id="auth-name" autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
          </>}
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          <label htmlFor="auth-password">Password</label>
          <div className="password-field">
            <input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 8 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? 'At least 8 characters' : 'Your password'} />
            <button type="button" className="password-toggle" onClick={() => setShowPassword((show) => !show)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          {isRegister && <>
            <label htmlFor="account-role">I’m here to</label>
            <select id="account-role" value={role} onChange={(event) => setRole(event.target.value as 'student' | 'instructor')}>
              <option value="student">Learn something new</option>
              <option value="instructor">Share what I know</option>
            </select>
          </>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-dark auth-submit" disabled={busy}>{busy ? 'One moment…' : isRegister ? 'Create your account' : 'Log in'} {!busy && <ArrowRight size={16} />}</button>
        </form>
        <p className="auth-switch">{isRegister ? 'Already learning with us?' : 'New around here?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Create an account'}</Link></p>
        <div className="auth-privacy"><ShieldCheck size={15} /> Your learning journey is yours. We keep your details safe.</div>
      </section>
      <aside className="auth-aside">
        <div className="auth-aside-content">
          <span className="auth-aside-asterisk">✳</span>
          <p>“The beautiful thing about learning is that nobody can take it away from you.”</p>
          <span>— B.B. King</span>
        </div>
        <div className="auth-aside-bottom">GOOD THINGS GROW HERE <span>✦</span> SKILLORA</div>
      </aside>
    </main>
  );
}

function PaymentNotice({ cancelled = false }: { cancelled?: boolean }) {
  return (
    <main className="notice-page">
      <div className="notice-symbol">{cancelled ? <X size={25} /> : <CheckCircle2 size={27} />}</div>
      <div className="eyebrow eyebrow-muted">{cancelled ? 'CHECKOUT PAUSED' : 'PAYMENT PROCESSING'}</div>
      <h1>{cancelled ? <>No rush. <span className="serif-accent">Your class is still here.</span></> : <>One little moment. <span className="serif-accent">Then you’re in.</span></>}</h1>
      <p>{cancelled ? 'You can come back to this class and finish checkout whenever you’re ready.' : 'Your payment is being confirmed. Once it’s complete, your new class will show up in My learning.'}</p>
      <div className="notice-actions"><Link className="button button-dark" to="/learn">My learning <ArrowRight size={16} /></Link><Link className="text-link" to="/courses">Keep exploring</Link></div>
    </main>
  );
}

function CourseGrid({ courses }: { courses: Course[] }) {
  return <div className="course-grid">{courses.map((course, index) => <CourseCard course={course} index={index} key={course.id} />)}</div>;
}

function CourseCard({ course, index }: { course: Course; index: number }) {
  return (
    <article className="course-card">
      <Link to={`/courses/${course.slug}`} className="course-card-art" aria-label={`View ${course.title}`}>
        {course.thumbnailUrl ? <img src={course.thumbnailUrl} alt="" loading="lazy" /> : <CourseArtwork course={course} index={index} />}
        <span className="course-card-badge">{course.category?.name ?? 'Skillora class'}</span>
        <span className="course-card-play"><Play size={16} fill="currentColor" /></span>
      </Link>
      <div className="course-card-body">
        <div className="course-card-meta"><span>{course.level.replace('_', ' ')}</span><span className="meta-dot">·</span><span>{formatDuration(course.totalDurationSeconds)}</span></div>
        <Link className="course-card-title" to={`/courses/${course.slug}`}><h3>{course.title}</h3></Link>
        <p className="course-card-instructor">with {course.instructor.name}</p>
        <div className="course-card-bottom">
          <span className="course-rating"><Star size={14} fill="currentColor" /> {course.ratingAverage.toFixed(1)} <span>({course.ratingCount})</span></span>
          <strong>{formatPrice(course.priceMinor, course.currency)}</strong>
        </div>
      </div>
    </article>
  );
}

function CourseArtwork({ course, index }: { course: Pick<Course, 'title'>; index: number }) {
  const variations = ['artwork-mint', 'artwork-peach', 'artwork-lavender', 'artwork-sky'];
  return (
    <div className={`course-artwork ${variations[index % variations.length]}`}>
      <span className="artwork-orbit" />
      <span className="artwork-shape artwork-shape-one" />
      <span className="artwork-shape artwork-shape-two" />
      <span className="artwork-label">A SKILLORA CLASS</span>
      <span className="artwork-title">{course.title}</span>
      <span className="artwork-sparkle">✳</span>
    </div>
  );
}

function CourseGridSkeleton() {
  return <div className="course-grid" aria-label="Loading courses">{Array.from({ length: 4 }, (_, index) => <div className="course-skeleton" key={index}><div /><span /><span /><span /></div>)}</div>;
}

function ErrorNotice({ message }: { message: string }) {
  return <div className="error-notice" role="alert"><span className="error-icon">!</span><div><strong>We couldn’t load this just now.</strong><p>{message}</p><p className="error-help">Check that the Skillora API is running, then try again.</p></div></div>;
}

function EmptyNotice({ title, message }: { title: string; message: string }) {
  return <div className="empty-notice"><span><BookOpen size={23} /></span><strong>{title}</strong><p>{message}</p></div>;
}

function PageLoading() {
  return <main className="page-loading"><span className="loading-dot" /><span>Finding your place…</span></main>;
}

function NotFoundPage() {
  return <main className="notice-page"><div className="eyebrow eyebrow-muted">A LITTLE OFF THE PATH</div><h1>That page went <span className="serif-accent">exploring.</span></h1><p>We couldn’t find what you’re looking for. Let’s get you back to something good.</p><div className="notice-actions"><Link className="button button-dark" to="/">Go home <ArrowRight size={16} /></Link><Link className="text-link" to="/courses">Browse classes</Link></div></main>;
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <Link className="brand footer-brand" to="/"><span className="brand-mark"><GraduationCap size={21} /></span><span>skillora<span className="brand-period">.</span></span></Link>
        <span className="footer-tagline">Make room for what moves you.</span>
        <div className="footer-links"><Link to="/courses">Explore</Link><Link to="/learn">My learning</Link><Link to="/register">Teach with us</Link></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} Skillora. Good things grow here.</span><span>Built for curious minds, everywhere.</span></div>
    </footer>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'S';
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something unexpected happened. Please try again.';
}

export default App;
