"""
TaskFlow Pro — Full-stack Task Manager
Flask + SQLite + Bootstrap
"""

import os
import json
import uuid
from datetime import datetime, date, timedelta
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for,
    flash, jsonify, session, send_from_directory
)
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

# ─── App Config ────────────────────────────────────────────────────────────
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'taskflow-secret-key-change-in-production-2024')
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(BASE_DIR, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(BASE_DIR, 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'txt', 'zip'}

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access your tasks.'
login_manager.login_message_category = 'info'

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# ─── Models ────────────────────────────────────────────────────────────────

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(100), nullable=False)
    email         = db.Column(db.String(150), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    avatar_color  = db.Column(db.String(20), default='#7c6af7')
    dark_mode     = db.Column(db.Boolean, default=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    tasks         = db.relationship('Task', backref='owner', lazy=True, cascade='all, delete-orphan')
    categories    = db.relationship('Category', backref='owner', lazy=True, cascade='all, delete-orphan')

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    @property
    def initials(self):
        parts = self.name.split()
        return (parts[0][0] + (parts[1][0] if len(parts) > 1 else '')).upper()


class Category(db.Model):
    __tablename__ = 'categories'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name       = db.Column(db.String(80), nullable=False)
    icon       = db.Column(db.String(10), default='📁')
    color      = db.Column(db.String(20), default='#7c6af7')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    tasks      = db.relationship('Task', backref='category', lazy=True)


class Task(db.Model):
    __tablename__ = 'tasks'
    id           = db.Column(db.Integer, primary_key=True)
    user_id      = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    category_id  = db.Column(db.Integer, db.ForeignKey('categories.id'), nullable=True)
    title        = db.Column(db.String(250), nullable=False)
    description  = db.Column(db.Text, default='')
    priority     = db.Column(db.String(20), default='medium')   # urgent|high|medium|low
    status       = db.Column(db.String(20), default='todo')     # todo|in_progress|done
    deadline     = db.Column(db.Date, nullable=True)
    position     = db.Column(db.Integer, default=0)
    is_deleted   = db.Column(db.Boolean, default=False)
    deleted_at   = db.Column(db.DateTime, nullable=True)
    links        = db.Column(db.Text, default='[]')             # JSON array of {url, label}
    tags         = db.Column(db.String(500), default='')        # comma-separated
    time_spent   = db.Column(db.Integer, default=0)             # seconds
    notify_before = db.Column(db.Integer, default=0)            # minutes before deadline
    snoozed_until = db.Column(db.DateTime, nullable=True)
    recur        = db.Column(db.String(20), default='')         # daily|weekly|monthly
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at   = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    subtasks     = db.relationship('SubTask', backref='task', lazy=True, cascade='all, delete-orphan')
    attachments  = db.relationship('Attachment', backref='task', lazy=True, cascade='all, delete-orphan')

    @property
    def links_list(self):
        try:
            return json.loads(self.links or '[]')
        except Exception:
            return []

    @property
    def tags_list(self):
        return [t.strip() for t in self.tags.split(',') if t.strip()] if self.tags else []

    @property
    def is_overdue(self):
        return (
            self.deadline and
            self.deadline < date.today() and
            self.status != 'done'
        )

    @property
    def subtask_progress(self):
        total = len(self.subtasks)
        if not total:
            return None
        done = sum(1 for s in self.subtasks if s.done)
        return {'done': done, 'total': total, 'pct': round(done / total * 100)}

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'priority': self.priority,
            'status': self.status,
            'deadline': self.deadline.isoformat() if self.deadline else None,
            'category_id': self.category_id,
            'tags': self.tags_list,
            'links': self.links_list,
            'time_spent': self.time_spent,
            'is_overdue': self.is_overdue,
            'position': self.position,
            'recur': self.recur,
            'created_at': self.created_at.isoformat(),
        }


class SubTask(db.Model):
    __tablename__ = 'subtasks'
    id      = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False)
    text    = db.Column(db.String(250), nullable=False)
    done    = db.Column(db.Boolean, default=False)
    position = db.Column(db.Integer, default=0)


class Attachment(db.Model):
    __tablename__ = 'attachments'
    id          = db.Column(db.Integer, primary_key=True)
    task_id     = db.Column(db.Integer, db.ForeignKey('tasks.id'), nullable=False)
    filename    = db.Column(db.String(250), nullable=False)
    stored_name = db.Column(db.String(250), nullable=False)
    file_size   = db.Column(db.Integer, default=0)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# ─── Helpers ───────────────────────────────────────────────────────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


DEFAULT_CATEGORIES = [
    ('Study',    '📚', '#60a5fa'),
    ('Office',   '💼', '#7c6af7'),
    ('Shopping', '🛒', '#34d399'),
    ('Coding',   '💻', '#f472b6'),
    ('Personal', '🏠', '#fbbf24'),
]


def seed_categories(user_id):
    for name, icon, color in DEFAULT_CATEGORIES:
        c = Category(user_id=user_id, name=name, icon=icon, color=color)
        db.session.add(c)
    db.session.commit()


# ─── Auth Routes ───────────────────────────────────────────────────────────

@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        email    = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        remember = bool(request.form.get('remember'))
        user = User.query.filter_by(email=email).first()
        if user and user.check_password(password):
            login_user(user, remember=remember)
            flash(f'Welcome back, {user.name}! 👋', 'success')
            return redirect(request.args.get('next') or url_for('dashboard'))
        flash('Invalid email or password.', 'danger')
    return render_template('login.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    if request.method == 'POST':
        name     = request.form.get('name', '').strip()
        email    = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        confirm  = request.form.get('confirm', '')
        if not name or not email or not password:
            flash('All fields are required.', 'danger')
        elif password != confirm:
            flash('Passwords do not match.', 'danger')
        elif len(password) < 6:
            flash('Password must be at least 6 characters.', 'danger')
        elif User.query.filter_by(email=email).first():
            flash('Email already registered.', 'danger')
        else:
            colors = ['#7c6af7','#f472b6','#60a5fa','#34d399','#fbbf24','#f87171']
            import random
            user = User(name=name, email=email, avatar_color=random.choice(colors))
            user.set_password(password)
            db.session.add(user)
            db.session.flush()
            seed_categories(user.id)
            db.session.commit()
            login_user(user)
            flash(f'Account created! Welcome, {name} 🎉', 'success')
            return redirect(url_for('dashboard'))
    return render_template('login.html', register=True)


@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('Logged out successfully.', 'info')
    return redirect(url_for('login'))


# ─── Dashboard ─────────────────────────────────────────────────────────────

@app.route('/dashboard')
@login_required
def dashboard():
    categories = Category.query.filter_by(user_id=current_user.id).all()
    # Stats
    all_tasks    = Task.query.filter_by(user_id=current_user.id, is_deleted=False).all()
    total        = len(all_tasks)
    done         = sum(1 for t in all_tasks if t.status == 'done')
    in_progress  = sum(1 for t in all_tasks if t.status == 'in_progress')
    overdue      = sum(1 for t in all_tasks if t.is_overdue)
    pct          = round(done / total * 100) if total else 0
    today_tasks  = [t for t in all_tasks if t.deadline == date.today() and t.status != 'done']
    return render_template(
        'dashboard.html',
        categories=categories,
        stats={'total': total, 'done': done, 'in_progress': in_progress, 'overdue': overdue, 'pct': pct},
        today_tasks=today_tasks,
        today=date.today().isoformat(),
    )


# ─── Task CRUD (JSON API) ──────────────────────────────────────────────────

@app.route('/api/tasks', methods=['GET'])
@login_required
def api_get_tasks():
    cat_id   = request.args.get('category')
    priority = request.args.get('priority')
    status   = request.args.get('status')
    search   = request.args.get('search', '').strip()
    sort_by  = request.args.get('sort', 'created')
    show_bin = request.args.get('bin') == '1'

    q = Task.query.filter_by(user_id=current_user.id, is_deleted=show_bin)

    if cat_id:
        q = q.filter_by(category_id=int(cat_id))
    if priority:
        q = q.filter_by(priority=priority)
    if status:
        q = q.filter_by(status=status)
    if search:
        q = q.filter(
            Task.title.ilike(f'%{search}%') |
            Task.description.ilike(f'%{search}%') |
            Task.tags.ilike(f'%{search}%')
        )

    if sort_by == 'deadline':
        q = q.order_by(Task.deadline.asc().nullslast())
    elif sort_by == 'priority':
        from sqlalchemy import case
        prio_order = case({'urgent': 0, 'high': 1, 'medium': 2, 'low': 3}, value=Task.priority)
        q = q.order_by(prio_order)
    elif sort_by == 'title':
        q = q.order_by(Task.title.asc())
    elif sort_by == 'position':
        q = q.order_by(Task.position.asc())
    else:
        q = q.order_by(Task.created_at.desc())

    tasks = q.all()

    result = []
    for t in tasks:
        d = t.to_dict()
        d['category_name']  = t.category.name  if t.category  else None
        d['category_icon']  = t.category.icon  if t.category  else None
        d['category_color'] = t.category.color if t.category  else None
        d['subtasks'] = [{'id': s.id, 'text': s.text, 'done': s.done} for s in t.subtasks]
        d['attachments'] = [{'id': a.id, 'filename': a.filename, 'size': a.file_size} for a in t.attachments]
        d['is_overdue']  = t.is_overdue
        d['subtask_progress'] = t.subtask_progress
        result.append(d)
    return jsonify(result)


@app.route('/api/tasks', methods=['POST'])
@login_required
def api_create_task():
    data = request.get_json()
    if not data or not data.get('title', '').strip():
        return jsonify({'error': 'Title required'}), 400

    deadline = None
    if data.get('deadline'):
        try:
            deadline = date.fromisoformat(data['deadline'])
        except ValueError:
            pass

    task = Task(
        user_id     = current_user.id,
        title       = data['title'].strip(),
        description = data.get('description', ''),
        priority    = data.get('priority', 'medium'),
        status      = data.get('status', 'todo'),
        deadline    = deadline,
        category_id = data.get('category_id') or None,
        tags        = ','.join(data.get('tags', [])),
        links       = json.dumps(data.get('links', [])),
        recur       = data.get('recur', ''),
        notify_before = int(data.get('notify_before', 0)),
    )
    db.session.add(task)
    # Add subtasks
    for i, st in enumerate(data.get('subtasks', [])):
        db.session.add(SubTask(task=task, text=st['text'], position=i))
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route('/api/tasks/<int:tid>', methods=['PUT'])
@login_required
def api_update_task(tid):
    task = Task.query.filter_by(id=tid, user_id=current_user.id).first_or_404()
    data = request.get_json()

    if 'title' in data:
        task.title = data['title'].strip()
    if 'description' in data:
        task.description = data['description']
    if 'priority' in data:
        task.priority = data['priority']
    if 'status' in data:
        task.status = data['status']
        if data['status'] == 'done' and not task.completed_at:
            task.completed_at = datetime.utcnow()
        elif data['status'] != 'done':
            task.completed_at = None
    if 'deadline' in data:
        task.deadline = date.fromisoformat(data['deadline']) if data['deadline'] else None
    if 'category_id' in data:
        task.category_id = data['category_id'] or None
    if 'tags' in data:
        task.tags = ','.join(data['tags'])
    if 'links' in data:
        task.links = json.dumps(data['links'])
    if 'position' in data:
        task.position = data['position']
    if 'recur' in data:
        task.recur = data['recur']
    if 'notify_before' in data:
        task.notify_before = int(data['notify_before'])
    if 'time_spent' in data:
        task.time_spent = int(data['time_spent'])

    # Replace subtasks
    if 'subtasks' in data:
        SubTask.query.filter_by(task_id=task.id).delete()
        for i, st in enumerate(data['subtasks']):
            db.session.add(SubTask(task_id=task.id, text=st['text'], done=st.get('done', False), position=i))

    task.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(task.to_dict())


@app.route('/api/tasks/<int:tid>', methods=['DELETE'])
@login_required
def api_delete_task(tid):
    task = Task.query.filter_by(id=tid, user_id=current_user.id).first_or_404()
    force = request.args.get('force') == '1'
    if force or task.is_deleted:
        # Delete attachments from disk
        for a in task.attachments:
            try:
                os.remove(os.path.join(app.config['UPLOAD_FOLDER'], a.stored_name))
            except Exception:
                pass
        db.session.delete(task)
    else:
        task.is_deleted = True
        task.deleted_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/tasks/<int:tid>/restore', methods=['POST'])
@login_required
def api_restore_task(tid):
    task = Task.query.filter_by(id=tid, user_id=current_user.id).first_or_404()
    task.is_deleted = False
    task.deleted_at = None
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/tasks/reorder', methods=['POST'])
@login_required
def api_reorder_tasks():
    data = request.get_json()  # [{id, position}, ...]
    for item in data:
        task = Task.query.filter_by(id=item['id'], user_id=current_user.id).first()
        if task:
            task.position = item['position']
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/tasks/export', methods=['GET'])
@login_required
def api_export_tasks():
    import csv
    import io
    fmt = request.args.get('fmt', 'json')
    tasks = Task.query.filter_by(user_id=current_user.id, is_deleted=False).all()
    if fmt == 'csv':
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['ID', 'Title', 'Description', 'Priority', 'Status', 'Category', 'Deadline', 'Tags', 'Created'])
        for t in tasks:
            writer.writerow([
                t.id, t.title, t.description, t.priority, t.status,
                t.category.name if t.category else '',
                t.deadline.isoformat() if t.deadline else '',
                t.tags, t.created_at.strftime('%Y-%m-%d')
            ])
        from flask import Response
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment;filename=tasks-{date.today()}.csv'}
        )
    # JSON export
    data = [t.to_dict() for t in tasks]
    from flask import Response
    return Response(
        json.dumps({'exported_at': datetime.utcnow().isoformat(), 'tasks': data}, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment;filename=tasks-{date.today()}.json'}
    )


# ─── Subtask toggle ────────────────────────────────────────────────────────

@app.route('/api/subtasks/<int:sid>/toggle', methods=['POST'])
@login_required
def toggle_subtask(sid):
    st = SubTask.query.get_or_404(sid)
    task = Task.query.filter_by(id=st.task_id, user_id=current_user.id).first_or_404()
    st.done = not st.done
    db.session.commit()
    return jsonify({'done': st.done, 'subtask_progress': task.subtask_progress})


# ─── Attachments ───────────────────────────────────────────────────────────

@app.route('/api/tasks/<int:tid>/attachments', methods=['POST'])
@login_required
def upload_attachment(tid):
    task = Task.query.filter_by(id=tid, user_id=current_user.id).first_or_404()
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    f = request.files['file']
    if not f.filename or not allowed_file(f.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    orig = secure_filename(f.filename)
    stored = f'{uuid.uuid4().hex}_{orig}'
    f.save(os.path.join(app.config['UPLOAD_FOLDER'], stored))
    size = os.path.getsize(os.path.join(app.config['UPLOAD_FOLDER'], stored))
    att = Attachment(task_id=tid, filename=orig, stored_name=stored, file_size=size)
    db.session.add(att)
    db.session.commit()
    return jsonify({'id': att.id, 'filename': att.filename, 'size': att.file_size})


@app.route('/api/attachments/<int:aid>', methods=['DELETE'])
@login_required
def delete_attachment(aid):
    att = Attachment.query.get_or_404(aid)
    Task.query.filter_by(id=att.task_id, user_id=current_user.id).first_or_404()
    try:
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], att.stored_name))
    except Exception:
        pass
    db.session.delete(att)
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/uploads/<path:filename>')
@login_required
def download_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# ─── Categories API ────────────────────────────────────────────────────────

@app.route('/api/categories', methods=['GET'])
@login_required
def api_get_categories():
    cats = Category.query.filter_by(user_id=current_user.id).all()
    result = []
    for c in cats:
        count = Task.query.filter_by(category_id=c.id, is_deleted=False).filter(Task.status != 'done').count()
        result.append({'id': c.id, 'name': c.name, 'icon': c.icon, 'color': c.color, 'count': count})
    return jsonify(result)


@app.route('/api/categories', methods=['POST'])
@login_required
def api_create_category():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    c = Category(user_id=current_user.id, name=name, icon=data.get('icon', '📁'), color=data.get('color', '#7c6af7'))
    db.session.add(c)
    db.session.commit()
    return jsonify({'id': c.id, 'name': c.name, 'icon': c.icon, 'color': c.color}), 201


@app.route('/api/categories/<int:cid>', methods=['DELETE'])
@login_required
def api_delete_category(cid):
    c = Category.query.filter_by(id=cid, user_id=current_user.id).first_or_404()
    Task.query.filter_by(category_id=cid).update({'category_id': None})
    db.session.delete(c)
    db.session.commit()
    return jsonify({'ok': True})


# ─── Settings ──────────────────────────────────────────────────────────────

@app.route('/api/settings', methods=['POST'])
@login_required
def update_settings():
    data = request.get_json()
    if 'dark_mode' in data:
        current_user.dark_mode = bool(data['dark_mode'])
    if 'name' in data:
        current_user.name = data['name'].strip() or current_user.name
    db.session.commit()
    return jsonify({'ok': True})


# ─── Stats API ─────────────────────────────────────────────────────────────

@app.route('/api/stats', methods=['GET'])
@login_required
def api_stats():
    all_tasks = Task.query.filter_by(user_id=current_user.id, is_deleted=False).all()
    total     = len(all_tasks)
    done      = sum(1 for t in all_tasks if t.status == 'done')
    overdue   = sum(1 for t in all_tasks if t.is_overdue)
    in_prog   = sum(1 for t in all_tasks if t.status == 'in_progress')
    time_tot  = sum(t.time_spent or 0 for t in all_tasks)
    cats      = Category.query.filter_by(user_id=current_user.id).all()
    cat_stats = []
    for c in cats:
        ct = sum(1 for t in all_tasks if t.category_id == c.id)
        cd = sum(1 for t in all_tasks if t.category_id == c.id and t.status == 'done')
        cat_stats.append({'name': c.name, 'icon': c.icon, 'color': c.color, 'total': ct, 'done': cd})
    return jsonify({
        'total': total, 'done': done, 'in_progress': in_prog,
        'overdue': overdue, 'pct': round(done / total * 100) if total else 0,
        'time_total': time_tot, 'categories': cat_stats,
        'bin_count': Task.query.filter_by(user_id=current_user.id, is_deleted=True).count(),
    })


# ─── Init DB ───────────────────────────────────────────────────────────────

with app.app_context():
    db.create_all()

import os

if __name__ == "__main__":
    with app.app_context():
        db.create_all()

    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        debug=False
    )