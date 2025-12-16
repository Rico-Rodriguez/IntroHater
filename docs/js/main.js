document.addEventListener('DOMContentLoaded', () => {
    // Header Scroll Effect
    const header = document.querySelector('header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'rgba(5, 5, 16, 0.95)';
            header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4)';
        } else {
            header.style.background = 'rgba(5, 5, 16, 0.8)';
            header.style.boxShadow = 'none';
        }
    });

    // Mobile Menu Toggle (if we add one later)
    // const menuBtn = document.querySelector('.menu-btn');
    // const navLinks = document.querySelector('.nav-links');
    
    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-fade-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal-on-scroll').forEach(el => {
        observer.observe(el);
    });
});