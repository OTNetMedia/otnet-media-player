export function createButton({ label, dataset = {}, onClick, active = false }) {
    const button = document.createElement('button');
    button.className = 'otnet__menu__item';

    button.textContent = label;

    Object.entries(dataset).forEach(([key, value]) => {
        button.setAttribute(`data-${key}`, value);
    });

    button.addEventListener('click', onClick);

    return button;
}

export function clearMenu(menu, selector) {
    menu.querySelectorAll(selector).forEach((el) => el.remove());
}

export function createBackButton(onClick) {
    const backButton = document.createElement('button');
    backButton.className = 'otnet__menu__back';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', onClick);
    return backButton;
}

export function createControlButton({
    label,
    dataset = {},
    onClick,
    active = false,
    id = '',
    className = '',
}) {
    const button = document.createElement('button');

    if (id) {
        button.id = id;
    }

    const base = ['otnet__controls__item', 'otnet__button'];
    const extra = className.split(' ').filter((c) => c.trim());
    button.className = [...base, ...extra].join(' ');

    if (active) {
        button.classList.add('active');
    }

    button.textContent = label;
    Object.entries(dataset).forEach(([k, v]) => {
        button.setAttribute(`data-${k}`, v);
    });
    button.addEventListener('click', onClick);

    return button;
}
